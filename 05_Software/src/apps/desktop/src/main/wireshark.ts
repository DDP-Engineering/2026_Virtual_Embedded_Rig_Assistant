import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  CaptureError,
  captureProfileEnvironment,
  type ProgramRunner,
  prepareWiresharkFrame,
  type SessionService,
} from "@vera/core";
import { captureLimits, type VeraError, veraError, veraErrorSchema } from "@vera/shared";
import { programEnv } from "./openers.js";
import type { WiresharkFrameSnapshots } from "./wireshark-snapshots.js";

type Citation = ReturnType<SessionService["openCaptureCitation"]>;
type Snapshot = Awaited<ReturnType<WiresharkFrameSnapshots["create"]>>;

const report = (code: VeraError["code"], key: string): VeraError => ({ ...veraError(code), messageKey: key });

async function executable(path: string, windows: boolean) {
  try {
    if (!(await stat(path)).isFile()) return false;
    if (!windows) await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Finds only an absolute native executable, keeping the process working directory out of PATH lookup. */
export async function discoverWireshark(platform: NodeJS.Platform, env: NodeJS.ProcessEnv) {
  if (platform !== "win32" && platform !== "linux") return undefined;
  const windows = platform === "win32";
  const path = Object.entries(env).find(([key]) =>
    windows ? key.toUpperCase() === "PATH" : key === "PATH",
  )?.[1];
  const standard = windows
    ? [env.ProgramW6432, env.ProgramFiles, env["ProgramFiles(x86)"]]
        .filter((root): root is string => !!root && isAbsolute(root))
        .map((root) => join(root, "Wireshark"))
    : ["/usr/bin", "/usr/local/bin"];
  const onPath = (path ?? "").split(windows ? ";" : ":").map((entry) => entry.replace(/^"(.*)"$/, "$1"));
  const name = windows ? "Wireshark.exe" : "wireshark";
  for (const folder of new Set([...standard, ...onPath].filter(isAbsolute))) {
    const desktop = join(folder, name);
    if (await executable(desktop, windows)) return desktop;
  }
  return undefined;
}

function startWireshark(command: string, args: string[], snapshot: Snapshot) {
  return new Promise<void>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...programEnv(process.env),
      ...captureProfileEnvironment(snapshot.folder),
    };
    // Xlib normally looks in the user's home when XAUTHORITY is unset.
    if (process.platform === "linux" && !env.XAUTHORITY && process.env.HOME)
      env.XAUTHORITY = join(process.env.HOME, ".Xauthority");
    const offlinePrefs = process.platform === "win32" ? ["-o", "gui.update.enabled:FALSE"] : [];
    const child = spawn(command, [...offlinePrefs, ...args], {
      cwd: dirname(command),
      detached: true,
      stdio: "ignore",
      shell: false,
      env,
    });
    // Detect a missing GUI runtime or a native startup failure, then let the viewer outlive VERA.
    const startup = setTimeout(() => {
      child.unref();
      resolve();
    }, 750);
    const failed = () => {
      clearTimeout(startup);
      reject(report("INTERNAL", "wireshark.launchFailed"));
    };
    child.once("error", failed);
    child.once("close", () => {
      failed();
      void snapshot.remove().catch(() => {});
    });
    if (child.pid !== undefined) {
      try {
        snapshot.recordViewer(child.pid);
      } catch {
        child.kill();
        failed();
      }
    }
  });
}

const nativeDesktop = {
  discover: () => discoverWireshark(process.platform, process.env),
  async tshark(desktop: string) {
    const windows = process.platform === "win32";
    const command = join(dirname(desktop), windows ? "tshark.exe" : "tshark");
    return process.getuid?.() !== 0 && (await executable(command, windows)) ? command : undefined;
  },
  start: startWireshark,
};

function openingError(error: unknown, signal: AbortSignal): VeraError {
  if (signal.aborted) return report("BUSY", "wireshark.timedOut");
  if (error instanceof CaptureError) {
    switch (error.reason) {
      case "capture_inaccessible":
        return report("NOT_FOUND", "wireshark.fileUnavailable");
      case "invalid_capture":
      case "capture_changed":
      case "capture_byte_limit":
        return report("CONFLICT", "wireshark.staleCapture");
      case "frame_mismatch":
        return report("CONFLICT", "wireshark.invalidCitation");
      case "invalid_filter":
      case "filter_unavailable":
        return report("INVALID", "wireshark.invalidFilter");
      case "invalid_decode_as":
        return report("CONFLICT", "wireshark.invalidCitation");
      case "tshark_unavailable":
        return report("NOT_FOUND", "wireshark.tsharkUnavailable");
    }
  }
  const known = veraErrorSchema.safeParse(error);
  if (known.success) {
    if (known.data.messageKey === "errors.NOT_FOUND" || known.data.messageKey === "errors.CONFLICT")
      return report("NOT_FOUND", "wireshark.invalidCitation");
    return known.data;
  }
  return report("INTERNAL", "wireshark.verificationFailed");
}

export async function openWiresharkFrame(
  readCitation: () => Citation,
  assertOwner: () => void,
  filter: string | undefined,
  runner: ProgramRunner,
  snapshots: WiresharkFrameSnapshots,
  native = nativeDesktop,
) {
  const signal = AbortSignal.timeout(captureLimits.deadlineMs);
  let snapshot: Snapshot | undefined;
  try {
    const { context, evidence } = readCitation();
    const desktop = await native.discover();
    if (!desktop) throw report("NOT_FOUND", "wireshark.desktopUnavailable");
    const tshark = await native.tshark(desktop);
    if (!tshark) throw report("NOT_FOUND", "wireshark.tsharkUnavailable");
    snapshot = await snapshots.create();
    const input = join(snapshot.folder, "input");
    await mkdir(input, { mode: 0o700 });
    const { capture } = evidence;
    const name =
      capture.source.kind === "workbench"
        ? basename(capture.source.path)
        : `${capture.sha256}.${capture.fileFormat}`;
    const path = join(input, name);
    const { args, filterAdjusted } = await prepareWiresharkFrame(
      context,
      evidence,
      filter,
      runner,
      tshark,
      snapshot.folder,
      path,
      signal,
    );
    signal.throwIfAborted();
    assertOwner();
    try {
      await native.start(desktop, args, snapshot);
    } catch {
      throw report("INTERNAL", "wireshark.launchFailed");
    }
    snapshot = undefined;
    return { filterAdjusted };
  } catch (error) {
    throw openingError(error, signal);
  } finally {
    await snapshot?.remove().catch(() => {});
  }
}
