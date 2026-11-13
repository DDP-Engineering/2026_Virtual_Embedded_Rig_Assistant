import { z } from "zod";

/**
 * The workbench registry of bench resources, `lab/resources.json` (spec REQ-DATA-f2cbfc23 §1). One file per
 * workbench: the host reads its identity fields to reserve resources, plugin helpers read the whole entry. Identity
 * kinds are data; later kinds (NIC, endpoint, lab host) add a branch here and a key function below.
 */
export const LAB_REGISTRY_PATH = "lab/resources.json";
export const LAB_REGISTRY_BYTES = 256 * 1024;

const printable = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[\x20-\x7e]+$/, "Use printable ASCII.");
const positive = z.number().positive();

const visaEntrySchema = z
  .strictObject({
    alias: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    kind: z.literal("visa"),
    resource: printable(256),
    serial: printable(64).optional(),
    profile: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    backend: z.enum(["py", "ivi"]).optional(),
    limits: z
      .record(
        z.string().regex(/^[A-Za-z0-9_-]{1,16}$/),
        z
          .record(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), positive)
          .refine((value) => Object.keys(value).length <= 8, "Declare at most 8 quantities."),
      )
      .refine((value) => Object.keys(value).length <= 16, "Declare at most 16 channels.")
      .optional(),
    note: z.string().max(256).optional(),
  })
  .superRefine((entry, ctx) => {
    try {
      visaResourceKeys(entry.resource);
    } catch (error) {
      ctx.addIssue({ code: "custom", path: ["resource"], message: (error as Error).message });
    }
  });
export const labResourceSchema = visaEntrySchema;
export type LabResource = z.infer<typeof labResourceSchema>;
export const labResourceKindSchema = z.enum(["visa"]);
export type LabResourceKind = z.infer<typeof labResourceKindSchema>;

export const labRegistrySchema = z
  .strictObject({
    format: z.literal(1),
    resources: z.array(labResourceSchema).min(1).max(64),
  })
  .superRefine((registry, ctx) => {
    const seen = new Set<string>();
    for (const [index, resource] of registry.resources.entries()) {
      if (seen.has(resource.alias))
        ctx.addIssue({
          code: "custom",
          path: ["resources", index, "alias"],
          message: "Use each alias once.",
        });
      seen.add(resource.alias);
    }
  });
export type LabRegistry = z.infer<typeof labRegistrySchema>;

const BOARD = "(\\d*)";
const HOST = "([A-Za-z0-9](?:[A-Za-z0-9.-]{0,252})|\\[[0-9A-Fa-f:.]{2,45}\\])";
const NUMBER = "(0x[0-9A-Fa-f]{1,4}|\\d{1,5})";
const ASRL = /^ASRL(?:(\d{1,3})|COM(\d{1,3})|(\/dev\/[\x21-\x7e]+?))::INSTR$/i;
const USB = new RegExp(
  `^USB${BOARD}::${NUMBER}::${NUMBER}::([\\x21-\\x39\\x3b-\\x7e]{1,64})(?:::(\\d{1,3}))?::(?:INSTR|RAW)$`,
  "i",
);
const TCPIP = new RegExp(`^TCPIP${BOARD}::${HOST}(?:::([A-Za-z0-9,_.-]{1,64}))?::INSTR$`, "i");
const SOCKET = new RegExp(`^TCPIP${BOARD}::${HOST}::(\\d{1,5})::SOCKET$`, "i");
const GPIB = new RegExp(`^GPIB${BOARD}::(\\d{1,2})(?:::(\\d{1,3}))?::INSTR$`, "i");

function word(text: string): number {
  const value = text.toLowerCase().startsWith("0x") ? Number.parseInt(text.slice(2), 16) : Number(text);
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw Error("A USB id is a 16-bit number.");
  return value;
}
const hex4 = (value: number) => value.toString(16).padStart(4, "0");

/** The key of a serial port as the runner's serial-port guard names it (COMn upper-cased, /dev paths verbatim). */
export function serialPortKey(port: string): string {
  return `serial:${/^com\d+$/i.test(port) ? port.toUpperCase() : port}`;
}

/**
 * Identity keys of a VISA resource name (spec REQ-DATA-f2cbfc23 §2): spellings of one connection share a key;
 * a declared serial number adds `serial-number:<value>`. Throws for any other syntax.
 */
export function visaResourceKeys(resource: string, serial?: string): string[] {
  const keys = [connectionKey(resource)];
  if (serial !== undefined) keys.push(`serial-number:${serial.toLowerCase()}`);
  return keys;
}

/** The key of the connection a VISA resource name opens. */
function connectionKey(resource: string): string {
  const asrl = ASRL.exec(resource);
  if (asrl) return asrl[3] ? serialPortKey(asrl[3]) : `serial:COM${Number(asrl[1] ?? asrl[2])}`;
  const usb = USB.exec(resource);
  if (usb)
    return `usb:${hex4(word(usb[2] as string))}:${hex4(word(usb[3] as string))}:${(usb[4] as string).toLowerCase()}`;
  const socket = SOCKET.exec(resource);
  if (socket) {
    const port = Number(socket[3]);
    if (port < 1 || port > 65_535) throw Error("A SOCKET resource needs a port from 1 to 65535.");
    return `tcpip:${(socket[2] as string).toLowerCase()}`;
  }
  const tcpip = TCPIP.exec(resource);
  if (tcpip) {
    const host = (tcpip[2] as string).toLowerCase();
    const device = tcpip[3]?.toLowerCase();
    return device === undefined || /^(?:inst|hislip)\d+$/.test(device)
      ? `tcpip:${host}`
      : `tcpip:${host}/${device}`;
  }
  const gpib = GPIB.exec(resource);
  if (gpib) {
    const primary = Number(gpib[2]);
    const secondary = gpib[3] === undefined ? undefined : Number(gpib[3]);
    if (primary > 30 || (secondary !== undefined && (secondary < 96 || secondary > 126)))
      throw Error("A GPIB address is 0..30, a secondary address 96..126.");
    return `gpib:${Number(gpib[1] || 0)}:${primary}${secondary === undefined ? "" : `:${secondary}`}`;
  }
  throw Error("Use a VISA resource name of the form ASRL, USB, TCPIP (INSTR or SOCKET) or GPIB.");
}

/** The identity keys of a registry entry. */
export function labResourceKeys(entry: LabResource): string[] {
  return visaResourceKeys(entry.resource, entry.serial);
}
