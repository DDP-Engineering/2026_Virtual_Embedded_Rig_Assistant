import { z } from "zod";

/**
 * The workbench registry of bench resources, `lab/resources.json` (spec REQ-DATA-f2cbfc23 §1). One file per
 * workbench: the host reads its identity fields to reserve resources, plugin helpers read the whole entry. Identity
 * kinds are data (`visa`, `bus-adapter`, `ble-device`, `linux-board`); later kinds (NIC, endpoint, lab host) add a branch here and a key function below.
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
/** A serial port as a bus adapter entry names it: `COM<n>` or a `/dev/` path. */
const serialPort = z
  .string()
  .regex(/^(?:[Cc][Oo][Mm][1-9]\d{0,2}|\/dev\/[\x21-\x7e]{1,250})$/, "Use COM<n> or a /dev/ path.");
/**
 * Kind `bus-adapter` (spec REQ-DATA-f2cbfc23 §1): a bus adapter reached on its binary serial port (`resource`) with a
 * second port (`terminal`) of the same device; `identity` is its USB key as the bus-tools plugin lists it.
 */
const busAdapterEntrySchema = z
  .strictObject({
    alias: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    kind: z.literal("bus-adapter"),
    backend: z.literal("bus-pirate-bpio2"),
    resource: serialPort,
    terminal: serialPort,
    identity: z
      .string()
      .regex(
        /^usb:[0-9A-Fa-f]{4}:[0-9A-Fa-f]{4}:[\x21-\x39\x3b-\x7e]{1,64}$/,
        "Use usb:<vid>:<pid>:<serial>.",
      ),
    power: z
      .strictObject({
        maxMv: z.number().int().min(800).max(5000),
        maxMa: z.number().int().min(1).max(500),
      })
      .optional(),
    note: z.string().max(256).optional(),
  })
  .refine((entry) => serialPortKey(entry.resource) !== serialPortKey(entry.terminal), {
    path: ["terminal"],
    message: "The terminal port must differ from the resource port.",
  });
/**
 * Kind `ble-device` (spec REQ-DATA-f2cbfc23 §1): a Bluetooth Low Energy device the ble-tools plugin reaches by its
 * identity address. A random address must be static (first octet's two most significant bits set): private addresses
 * change. `profile` names the device profile the unit follows; `serial` is the value its identity characteristic reports.
 */
const bleDeviceEntrySchema = z
  .strictObject({
    alias: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    kind: z.literal("ble-device"),
    address: z
      .string()
      .regex(/^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}$/, "Use six colon-separated hex octets."),
    addressType: z.enum(["public", "random"]),
    profile: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    serial: printable(64).optional(),
    adapter: z
      .string()
      .regex(/^hci(?:[0-9]|[1-9][0-9])$/, "Use a BlueZ adapter name hci0 to hci99.")
      .optional(),
    note: z.string().max(256).optional(),
  })
  .refine(
    (entry) =>
      entry.addressType === "public" || (Number.parseInt(entry.address.slice(0, 2), 16) & 0xc0) === 0xc0,
    { path: ["address"], message: "A random address must be static; private addresses change." },
  );
/** A SHA-256 key fingerprint as OpenSSH prints it (`SHA256:` and 43 unpadded base64 characters). */
const fingerprint = z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/, "Use SHA256:<43 base64 characters>.");
const rootSegment = /^[A-Za-z0-9._-]+$/;
/**
 * Kind `linux-board` (spec REQ-DATA-f2cbfc23 §1): a Linux board (a Raspberry Pi) the raspberry-pi-linux plugin reaches
 * over SSH as an unprivileged `user`, accepting only a host key whose fingerprint `hostKeys` pins, checking the board's
 * `identity` and working below the absolute remote `root`.
 */
const linuxBoardEntrySchema = z.strictObject({
  alias: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  kind: z.literal("linux-board"),
  host: z
    .string()
    .regex(
      /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,252})|[0-9A-Fa-f:.]{2,45})$/,
      "Use a host name, an IPv4 address or an IPv6 address without brackets.",
    ),
  port: z.number().int().min(1).max(65_535),
  user: z
    .string()
    .regex(/^[a-z_][a-z0-9_-]{0,31}$/, "Use a lower-case login name.")
    .refine((user) => user !== "root", "Use an unprivileged user; root is refused."),
  hostKeys: z.array(fingerprint).max(4),
  agentKey: fingerprint.optional(),
  identity: z
    .strictObject({
      serial: z
        .string()
        .regex(/^[0-9A-Fa-f]{8,32}$/)
        .optional(),
      machineId: z
        .string()
        .regex(/^[0-9a-f]{32}$/)
        .optional(),
      model: printable(128).optional(),
    })
    .refine((identity) => identity.serial !== undefined || identity.machineId !== undefined, {
      message: "Declare the board's serial or machine id.",
    }),
  root: z
    .string()
    .max(256)
    .refine((root) => {
      const segments = root.split("/");
      return (
        segments[0] === "" &&
        segments.length >= 3 &&
        segments.length <= 17 &&
        segments.slice(1).every((segment) => rootSegment.test(segment) && segment !== "." && segment !== "..")
      );
    }, "Use an absolute path of 2 to 16 segments of letters, digits, dot, underscore and dash, without . or ..."),
  note: z.string().max(256).optional(),
});
export const labResourceSchema = z.union([
  visaEntrySchema,
  busAdapterEntrySchema,
  bleDeviceEntrySchema,
  linuxBoardEntrySchema,
]);
export type LabResource = z.infer<typeof labResourceSchema>;
export const labResourceKindSchema = z.enum(["visa", "bus-adapter", "ble-device", "linux-board"]);
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
  if (entry.kind === "bus-adapter")
    return [serialPortKey(entry.resource), serialPortKey(entry.terminal), entry.identity.toLowerCase()];
  if (entry.kind === "ble-device") return [`ble:${entry.address.toLowerCase()}`];
  if (entry.kind === "linux-board") return [`ssh:${entry.host.toLowerCase()}:${entry.port}`];
  return visaResourceKeys(entry.resource, entry.serial);
}
