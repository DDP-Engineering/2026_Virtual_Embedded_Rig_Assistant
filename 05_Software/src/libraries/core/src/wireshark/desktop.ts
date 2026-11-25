import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CaptureAnalysis,
  type CaptureFrameReference,
  type CaptureReference,
  captureLimits,
} from "@vera/shared";
import type { ProgramRunner } from "../plugins/runner.js";
import type { ToolContext } from "../tools/context.js";
import { CaptureError, captureDecodeArgs, emptyPcap, OfflineTshark } from "./native.js";
import { snapshotCapture } from "./storage.js";

interface DesktopFrame {
  capture: CaptureReference;
  frame: CaptureFrameReference;
  analysis: CaptureAnalysis;
}

const epoch = (time: string | null) => time?.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") ?? null;

/** Copy the exact cited file, then verify the referenced frame and display settings on that copy. */
export async function prepareWiresharkFrame(
  context: ToolContext,
  evidence: DesktopFrame,
  displayFilter: string | undefined,
  runner: ProgramRunner,
  tshark: string,
  folder: string,
  path: string,
  signal: AbortSignal,
) {
  const { capture, frame } = evidence;
  const analysis = { ...evidence.analysis, filter: displayFilter ?? evidence.analysis.filter };
  const mismatch = () =>
    new CaptureError("frame_mismatch", "The frame does not belong to the cited capture.");
  if (frame.captureSha256 !== capture.sha256 || frame.number > captureLimits.scanFrames) throw mismatch();
  await snapshotCapture(context, { reference: capture }, path, signal);
  const native = new OfflineTshark(runner, tshark, folder, signal);
  if (analysis.filter || analysis.decodeAs.length) {
    await writeFile(join(folder, "empty.pcap"), emptyPcap, { mode: 0o600, flag: "wx" });
    await native.validate(analysis);
  }
  const frameFilter = `frame.number == ${frame.number}`;
  if (!(await native.numbers(path, analysis, frame.number, frameFilter)).includes(frame.number))
    throw mismatch();
  const [packet] = await native.packets(path, analysis, [frame.number], [], capture.sha256);
  if (
    !packet ||
    packet.frame.interfaceId !== frame.interfaceId ||
    epoch(packet.frame.timestampEpoch) !== epoch(frame.timestampEpoch)
  )
    throw mismatch();

  const matches = analysis.filter
    ? (await native.numbers(path, analysis, frame.number, `(${analysis.filter}) && ${frameFilter}`)).includes(
        frame.number,
      )
    : true;
  const filter = matches ? analysis.filter : `(${analysis.filter}) || ${frameFilter}`;
  return {
    args: [
      "-n",
      "-r",
      path,
      "-g",
      String(frame.number),
      ...captureDecodeArgs(analysis.decodeAs),
      ...(filter ? ["-Y", filter] : []),
    ],
    filterAdjusted: !matches,
  };
}
