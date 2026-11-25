import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaptureAnalysis, CaptureFrameReference, CaptureReference } from "@vera/shared";
import { expect, it, vi } from "vitest";
import type { ProgramRunner } from "../plugins/runner.js";
import { createToolContext } from "../tools/context.js";
import { prepareWiresharkFrame } from "./desktop.js";

it("keeps the exact cited bytes and frame, adjusts hiding filters, and refuses incompatible evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-frame-test-"));
  const workbench = join(root, "workbench");
  const name = "Dérivé cu spații.pcapng";
  const file = join(workbench, name);
  const bytes = await readFile(
    new URL("../../../../../tests/fixtures/wireshark-tshark/sample.pcapng", import.meta.url),
  );
  const capture: CaptureReference = {
    format: 1,
    source: { kind: "workbench", path: name },
    fileFormat: "pcapng",
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const frame: CaptureFrameReference = {
    captureSha256: capture.sha256,
    number: 3,
    interfaceId: 0,
    timestampEpoch: "1767225600.2",
  };
  const analysis: CaptureAnalysis = {
    tool: "tshark",
    version: "4.6.10",
    profile: "vera-offline-v1",
    decodeAs: [],
    filter: "coap",
  };
  const run = vi.fn<ProgramRunner["captureOutput"]>(async ({ args }) => {
    const filter = args[args.indexOf("-Y") + 1];
    if (filter === "(")
      return { exit: { code: 2, signal: null }, stdout: "", stderr: "Invalid filter", exceeded: false };
    const stdout = args.includes("json")
      ? JSON.stringify([
          {
            _source: {
              layers: {
                "frame.number": ["3"],
                "frame.interface_id": ["0"],
                "frame.time_epoch": ["1767225600.200000000"],
                "frame.len": ["62"],
                "frame.cap_len": ["62"],
              },
            },
          },
        ])
      : filter === "(arp) && frame.number == 3" ||
          filter === "frame.number == 4" ||
          args.includes(join(root, "empty.pcap"))
        ? ""
        : "3\n";
    return { exit: { code: 0, signal: null }, stdout, stderr: "", exceeded: false };
  });
  const runner = { captureOutput: run } as unknown as ProgramRunner;
  async function prepare(filter?: string, expected = frame, reference = capture) {
    const folder = await mkdtemp(join(root, "scratch-"));
    const path = join(folder, name);
    const result = await prepareWiresharkFrame(
      createToolContext(workbench),
      { capture: reference, frame: expected, analysis },
      filter,
      runner,
      "tshark",
      folder,
      path,
      new AbortController().signal,
    );
    expect(await readFile(path)).toEqual(bytes);
    return { ...result, path };
  }
  try {
    await mkdir(workbench);
    await writeFile(file, bytes);
    const preserved = await prepare();
    expect(preserved.args).toEqual(["-n", "-r", preserved.path, "-g", "3", "-Y", "coap"]);
    expect(preserved.filterAdjusted).toBe(false);
    const adjusted = await prepare("arp");
    expect(adjusted.args.at(-1)).toBe("(arp) || frame.number == 3");
    expect(adjusted.filterAdjusted).toBe(true);
    await expect(prepare("(")).rejects.toMatchObject({ reason: "invalid_filter" });
    await expect(prepare(undefined, { ...frame, captureSha256: "0".repeat(64) })).rejects.toMatchObject({
      reason: "frame_mismatch",
    });
    await expect(prepare(undefined, { ...frame, number: 4 })).rejects.toMatchObject({
      reason: "frame_mismatch",
    });
    await expect(prepare(undefined, { ...frame, interfaceId: 1 })).rejects.toMatchObject({
      reason: "frame_mismatch",
    });
    const outside = `../${name}`;
    await writeFile(join(root, name), bytes);
    await expect(
      prepare(undefined, frame, { ...capture, source: { kind: "workbench", path: outside } }),
    ).rejects.toMatchObject({ reason: "capture_inaccessible" });
    const changed = Buffer.from(bytes);
    changed.writeUInt8(changed.readUInt8(40) ^ 1, 40);
    await writeFile(file, changed);
    await expect(prepare()).rejects.toMatchObject({ reason: "capture_changed" });
    await rm(file);
    await expect(prepare()).rejects.toMatchObject({ reason: "capture_inaccessible" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
