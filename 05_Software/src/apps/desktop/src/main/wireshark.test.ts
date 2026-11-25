import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProgramRunner, SessionService } from "@vera/core";
import { veraError } from "@vera/shared";
import { expect, it, vi } from "vitest";
import { discoverWireshark, openWiresharkFrame } from "./wireshark.js";
import { WiresharkFrameSnapshots } from "./wireshark-snapshots.js";

it("discovers a Windows native executable from an absolute PATH entry", async () => {
  if (process.platform !== "win32") return;
  const root = await mkdtemp(join(tmpdir(), "vera-wireshark-discovery-"));
  try {
    await expect(discoverWireshark("win32", { Path: root })).resolves.toBeUndefined();
    const executable = join(root, "Wireshark.exe");
    await writeFile(executable, "fixture");
    await expect(discoverWireshark("win32", { Path: `.;"${root}"` })).resolves.toBe(executable);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("reports incompatible citations, missing native tools and process startup failure separately", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-wireshark-launch-"));
  const file = "Échelon 3.pcapng";
  try {
    const bytes = await readFile(
      new URL("../../../../../tests/fixtures/wireshark-tshark/sample.pcapng", import.meta.url),
    );
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(join(root, file), bytes);
    const read: () => ReturnType<SessionService["openCaptureCitation"]> = () => ({
      context: { root, lastReads: new Map() },
      evidence: {
        capture: {
          format: 1,
          source: { kind: "workbench", path: file },
          fileFormat: "pcapng",
          bytes: bytes.length,
          sha256,
        },
        frame: { number: 3, interfaceId: 0, timestampEpoch: "1767225600.2", captureSha256: sha256 },
        analysis: {
          tool: "tshark",
          version: "4.6.10",
          profile: "vera-offline-v1",
          decodeAs: [],
          filter: null,
        },
      },
    });
    const assertOwner = vi.fn();
    const captureOutput = vi.fn<ProgramRunner["captureOutput"]>(async ({ args }) => ({
      exit: { code: 0, signal: null },
      stdout: args.includes("json")
        ? JSON.stringify([
            {
              _source: {
                layers: {
                  "frame.number": ["3"],
                  "frame.interface_id": ["0"],
                  "frame.time_epoch": ["1767225600.2"],
                  "frame.len": ["62"],
                  "frame.cap_len": ["62"],
                },
              },
            },
          ])
        : "3\n",
      stderr: "",
      exceeded: false,
    }));
    const runner = { captureOutput } as unknown as ProgramRunner;
    const discover = vi.fn<() => Promise<string | undefined>>().mockResolvedValue(undefined);
    const tshark = vi.fn<() => Promise<string | undefined>>().mockResolvedValue(undefined);
    const start = vi.fn(async () => {
      throw Error("could not start");
    });
    const native = { discover, tshark, start };
    const snapshots = new WiresharkFrameSnapshots(root);
    const open = (lookup = read) =>
      openWiresharkFrame(lookup, assertOwner, undefined, runner, snapshots, native);
    await expect(
      open(() => {
        throw veraError("NOT_FOUND");
      }),
    ).rejects.toMatchObject({ messageKey: "wireshark.invalidCitation" });
    expect(discover).not.toHaveBeenCalled();
    await expect(open()).rejects.toMatchObject({ messageKey: "wireshark.desktopUnavailable" });
    discover.mockResolvedValue(join(root, "Wireshark.exe"));
    await expect(open()).rejects.toMatchObject({ messageKey: "wireshark.tsharkUnavailable" });
    expect(start).not.toHaveBeenCalled();
    tshark.mockResolvedValue(join(root, "tshark.exe"));
    await expect(open()).rejects.toMatchObject({ messageKey: "wireshark.launchFailed" });
    expect(assertOwner).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
