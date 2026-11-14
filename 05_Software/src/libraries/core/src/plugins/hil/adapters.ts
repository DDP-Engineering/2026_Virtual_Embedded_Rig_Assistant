import { noControlCharacters } from "@vera/shared";
import { z } from "zod";

/**
 * HIL step adapters (spec REQ-DATA-5f714098 §3): each maps a plan step's `use` to a program of an enabled plugin and
 * builds its argument list. An adapter never chooses a risk; the program's manifest rules classify what it builds.
 * Later plans register further adapters here; they never add a second executor.
 */
export type HilAttemptStatus = "pass" | "fail" | "blocked" | "error" | "incomplete";
export interface HilFirmware {
  readonly path: string;
  readonly format: "elf" | "hex" | "bin";
  readonly address?: string | undefined;
}
export interface HilBuildContext {
  readonly firmware: HilFirmware;
  /** Workbench-relative folder of this step's own results (`embedded-lab-results/<run>/steps/<id>`). */
  readonly folder: string;
}
// biome-ignore lint/suspicious/noExplicitAny: each adapter types its own parameters.
export interface HilAdapter<P = any> {
  readonly use: string;
  /** The plugin program the step runs; absent for steps the executor handles itself (`await`). */
  readonly program?: string;
  readonly params: z.ZodType<P>;
  args(params: P, context: HilBuildContext): string[];
  /** Whether `retries` and `repeat` are allowed (never for flash, reset, output or configure). */
  repeatable(params: P): boolean;
  /** Whether the step may run in the background until an `await` or the end of the steps. */
  readonly background: boolean;
  /** Writes the plan's firmware to the target. */
  readonly flashes: boolean;
  /** Starts the firmware (a reset or a run after programming). */
  resets(params: P): boolean;
  /** Firmware formats the adapter accepts; absent when it does not read the firmware. */
  readonly formats?: readonly HilFirmware["format"][];
  /** Probe selectors the step uses (reserved as `probe:<selector>`). */
  probes(params: P): string[];
  /** The step writes run folders into its folder (scpi, lab-validate). */
  readonly folders: boolean;
  /** The attempt's outcome from the program's exit code (a process that ran to its end). */
  outcome(exitCode: number | null): HilAttemptStatus;
}

const registry = new Map<string, HilAdapter>();
/** Adds an adapter; a `use` is registered once. */
export function registerHilAdapter<P>(adapter: HilAdapter<P>): void {
  if (registry.has(adapter.use)) throw Error(`HIL adapter ${adapter.use} is already registered.`);
  registry.set(adapter.use, adapter as HilAdapter);
}
export function hilAdapter(use: string): HilAdapter | undefined {
  return registry.get(use);
}
export function hilAdapterNames(): string[] {
  return [...registry.keys()].sort();
}

// --- Parameter types -------------------------------------------------------------------------------------------
const noOption = "A value must not start with '-'.";
const plain = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(noControlCharacters, "Use no control characters.")
    .refine((value) => !value.startsWith("-"), noOption);
const probe = z
  .string()
  .regex(
    /^[0-9A-Fa-f]{4}:[0-9A-Fa-f]{4}(?:[:-][A-Za-z0-9_.]{1,64})?$/,
    "Use VID:PID[:SERIAL] or VID:PID-INTERFACE.",
  );
const chip = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
const port = z
  .string()
  .regex(
    /^(?:COM[1-9][0-9]{0,2}|\/dev\/tty[A-Za-z0-9._-]{1,64}|\/dev\/serial\/by-id\/[A-Za-z0-9._:+-]{1,200})$/,
    "Use COMn, /dev/tty* or /dev/serial/by-id/*.",
  );
const baud = z.number().int().min(1).max(4_000_000);
const duration = z.number().min(0.1).max(3600);
const alias = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "Use a lab/resources.json alias.");
const channel = z.string().regex(/^[A-Za-z0-9_]{1,16}$/);
const quantity = z.number().positive().max(1e6);

// --- Exit-code mappings ------------------------------------------------------------------------------------------
const zeroPasses = (code: number | null): HilAttemptStatus => (code === 0 ? "pass" : "error");
/** serial-monitor: 4 when `--until` never matched. */
const serialOutcome = (code: number | null): HilAttemptStatus =>
  code === 0 ? "pass" : code === 4 ? "fail" : "error";
/** scpi-instruments: 1 fail, 2 refused or blocked before any effect, 3 incomplete or error during I/O. */
const scpiOutcome = (code: number | null): HilAttemptStatus =>
  code === 0 ? "pass" : code === 1 ? "fail" : code === 2 ? "blocked" : "error";
/** lab-validate: 1 fail, 2 refused request, 3 incomplete. */
const validateOutcome = (code: number | null): HilAttemptStatus =>
  code === 0 ? "pass" : code === 1 ? "fail" : code === 3 ? "incomplete" : "error";

const never = () => false;
const always = () => true;
const none = () => [];
const base = { background: false, flashes: false, folders: false, resets: never, probes: none } as const;

// --- probe-rs ---------------------------------------------------------------------------------------------------
const target = z.strictObject({ probe, chip });
type Target = z.infer<typeof target>;
const targetArgs = (params: Target) => ["--probe", params.probe, "--chip", params.chip, "--non-interactive"];
const imageArgs = (firmware: HilFirmware) => [
  "--binary-format",
  firmware.format,
  ...(firmware.address ? ["--base-address", firmware.address] : []),
  firmware.path,
];
registerHilAdapter({
  ...base,
  use: "probe-rs.list",
  program: "probe-rs",
  params: z.strictObject({}),
  args: () => ["list"],
  repeatable: always,
  outcome: zeroPasses,
});
registerHilAdapter<Target>({
  ...base,
  use: "probe-rs.flash",
  program: "probe-rs",
  params: target,
  args: (params, { firmware }) => ["download", ...targetArgs(params), ...imageArgs(firmware)],
  repeatable: never,
  flashes: true,
  formats: ["elf", "hex", "bin"],
  probes: (params) => [params.probe],
  outcome: zeroPasses,
});
registerHilAdapter<Target>({
  ...base,
  use: "probe-rs.verify",
  program: "probe-rs",
  params: target,
  args: (params, { firmware }) => ["verify", ...targetArgs(params), ...imageArgs(firmware)],
  repeatable: always,
  formats: ["elf", "hex", "bin"],
  probes: (params) => [params.probe],
  outcome: zeroPasses,
});
registerHilAdapter<Target>({
  ...base,
  use: "probe-rs.reset",
  program: "probe-rs",
  params: target,
  args: (params) => ["reset", ...targetArgs(params)],
  repeatable: never,
  resets: always,
  probes: (params) => [params.probe],
  outcome: zeroPasses,
});

// --- esp32-esptool -------------------------------------------------------------------------------------------------
const espPort = z.strictObject({ port });
const espTarget = z.strictObject({ port, chip });
type EspTarget = z.infer<typeof espTarget>;
const address = (firmware: HilFirmware) => firmware.address ?? "0x0";
registerHilAdapter<z.infer<typeof espPort>>({
  ...base,
  use: "esptool.identify",
  program: "esptool",
  params: espPort,
  args: (params) => ["--port", params.port, "chip-id"],
  repeatable: always,
  resets: always,
  outcome: zeroPasses,
});
registerHilAdapter<EspTarget>({
  ...base,
  use: "esptool.flash",
  program: "esptool",
  params: espTarget,
  args: (params, { firmware }) => [
    "--chip",
    params.chip,
    "--port",
    params.port,
    "write-flash",
    address(firmware),
    firmware.path,
  ],
  repeatable: never,
  flashes: true,
  resets: always,
  formats: ["bin"],
  outcome: zeroPasses,
});
registerHilAdapter<EspTarget>({
  ...base,
  use: "esptool.verify",
  program: "esptool",
  params: espTarget,
  args: (params, { firmware }) => [
    "--chip",
    params.chip,
    "--port",
    params.port,
    "verify-flash",
    address(firmware),
    firmware.path,
  ],
  repeatable: always,
  resets: always,
  formats: ["bin"],
  outcome: zeroPasses,
});

// --- serial-monitor ------------------------------------------------------------------------------------------------
const capture = z.strictObject({
  port,
  baud,
  duration,
  until: plain(256).optional(),
  reset: z.boolean().optional(),
});
type Capture = z.infer<typeof capture>;
registerHilAdapter<Capture>({
  ...base,
  use: "serial.capture",
  program: "serial",
  params: capture,
  args: (params) => [
    "capture",
    "--port",
    params.port,
    "--baud",
    String(params.baud),
    "--duration",
    String(params.duration),
    ...(params.until === undefined ? [] : ["--until", params.until]),
    ...(params.reset ? ["--reset"] : []),
  ],
  // A DTR/RTS reset is never repeated automatically.
  repeatable: (params) => params.reset !== true,
  background: true,
  resets: (params) => params.reset === true,
  outcome: serialOutcome,
});
const send = z.strictObject({
  port,
  baud,
  duration,
  text: plain(512),
  eol: z.enum(["crlf", "lf", "cr", "none"]).optional(),
  until: plain(256).optional(),
});
type Send = z.infer<typeof send>;
registerHilAdapter<Send>({
  ...base,
  use: "serial.send",
  program: "serial",
  params: send,
  args: (params) => [
    "send",
    "--port",
    params.port,
    "--baud",
    String(params.baud),
    "--duration",
    String(params.duration),
    "--text",
    params.text,
    "--eol",
    params.eol ?? "crlf",
    ...(params.until === undefined ? [] : ["--until", params.until]),
  ],
  repeatable: always,
  outcome: serialOutcome,
});

// --- scpi-instruments ----------------------------------------------------------------------------------------------
const instrument = z.strictObject({ instrument: alias });
type Instrument = z.infer<typeof instrument>;
const results = (folder: string) => ["--results-dir", folder];
for (const operation of ["identify", "status"] as const)
  registerHilAdapter<Instrument>({
    ...base,
    use: `scpi.${operation}`,
    program: "scpi",
    params: instrument,
    args: (params, { folder }) => [operation, "--instrument", params.instrument, ...results(folder)],
    repeatable: always,
    folders: true,
    outcome: scpiOutcome,
  });
const reading = z.strictObject({ instrument: alias, channel: channel.optional() });
registerHilAdapter<z.infer<typeof reading>>({
  ...base,
  use: "scpi.read",
  program: "scpi",
  params: reading,
  args: (params, { folder }) => [
    "read",
    "--instrument",
    params.instrument,
    ...(params.channel ? ["--channel", params.channel] : []),
    ...results(folder),
  ],
  repeatable: always,
  folders: true,
  outcome: scpiOutcome,
});
const channelOf = z.strictObject({ instrument: alias, channel });
registerHilAdapter<z.infer<typeof channelOf>>({
  ...base,
  use: "scpi.capture",
  program: "scpi",
  params: channelOf,
  args: (params, { folder }) => [
    "capture",
    "--instrument",
    params.instrument,
    "--channel",
    params.channel,
    ...results(folder),
  ],
  repeatable: always,
  folders: true,
  outcome: scpiOutcome,
});
const configure = z.strictObject({
  instrument: alias,
  set: z
    .array(z.string().regex(/^[A-Za-z0-9_.]{1,64}=[A-Za-z0-9_.+-]{1,64}$/, "Use NAME=VALUE."))
    .min(1)
    .max(16),
});
registerHilAdapter<z.infer<typeof configure>>({
  ...base,
  use: "scpi.configure",
  program: "scpi",
  params: configure,
  args: (params, { folder }) => [
    "configure",
    "--instrument",
    params.instrument,
    ...params.set.flatMap((setting) => ["--set", setting]),
    ...results(folder),
  ],
  repeatable: never,
  folders: true,
  outcome: scpiOutcome,
});
const output = z.strictObject({
  instrument: alias,
  channel,
  voltage: quantity,
  current: quantity,
  hold: z.number().int().min(1).max(3500),
});
registerHilAdapter<z.infer<typeof output>>({
  ...base,
  use: "scpi.output",
  program: "scpi",
  params: output,
  args: (params, { folder }) => [
    "output",
    "--instrument",
    params.instrument,
    "--channel",
    params.channel,
    "--voltage",
    String(params.voltage),
    "--current",
    String(params.current),
    "--hold",
    String(params.hold),
    ...results(folder),
  ],
  repeatable: never,
  background: true,
  folders: true,
  outcome: scpiOutcome,
});
registerHilAdapter<Instrument>({
  ...base,
  use: "scpi.close",
  program: "scpi",
  params: instrument,
  args: (params, { folder }) => ["close", "--instrument", params.instrument, ...results(folder)],
  repeatable: never,
  folders: true,
  outcome: scpiOutcome,
});

// --- lab-validation ------------------------------------------------------------------------------------------------
const evaluate = z.strictObject({ request: z.record(z.string(), z.unknown()) });
export type HilEvaluateParams = z.infer<typeof evaluate>;
registerHilAdapter<HilEvaluateParams>({
  ...base,
  use: "lab-validate.compare",
  program: "lab-validate",
  params: evaluate,
  args: (_params, { folder }) => ["compare", "--request", `${folder}.request.json`, ...results(folder)],
  repeatable: never,
  folders: true,
  outcome: validateOutcome,
});

// --- executor steps ------------------------------------------------------------------------------------------------
const awaited = z.strictObject({ step: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/) });
export type HilAwaitParams = z.infer<typeof awaited>;
registerHilAdapter<HilAwaitParams>({
  ...base,
  use: "await",
  params: awaited,
  args: () => [],
  repeatable: never,
  outcome: zeroPasses,
});
