import { createHash } from "node:crypto";
import type { Message } from "@earendil-works/pi-ai";
import {
  type CaptureAnalysis,
  type CaptureFrameReference,
  type CaptureReference,
  captureAnalysisSchema,
  captureFrameReferenceSchema,
  captureLimits,
  capturePacketSchema,
  captureReferenceSchema,
  captureTrafficFrameSchema,
  formatRef,
} from "@vera/shared";
import { z } from "zod";

const resultSchema = z.object({
  capture: captureReferenceSchema,
  analysis: captureAnalysisSchema,
  packet: capturePacketSchema.optional(),
  packets: z.array(capturePacketSchema).max(captureLimits.pageRows).optional(),
  traffic: z
    .object({ evidence: z.array(captureTrafficFrameSchema).max(captureLimits.pageRows * 2 + 9) })
    .optional(),
});

export function captureCitation(
  capture: CaptureReference,
  frame: CaptureFrameReference,
  analysis: CaptureAnalysis,
) {
  const identity = createHash("sha256")
    .update(
      JSON.stringify([
        captureReferenceSchema.parse(capture),
        captureFrameReferenceSchema.parse(frame),
        captureAnalysisSchema.parse(analysis),
      ]),
    )
    .digest("hex");
  return formatRef({ kind: "capture", identity, frame: frame.number });
}

/** Only the successful typed offline tool can issue a frame citation. */
export function issuedCaptureCitations(messages: readonly Message[]) {
  const evidence = new Map<
    string,
    { capture: CaptureReference; frame: CaptureFrameReference; analysis: CaptureAnalysis }
  >();
  for (const message of messages) {
    if (message.role !== "toolResult" || message.toolName !== "wireshark_capture" || message.isError)
      continue;
    for (const part of message.content) {
      if (part.type !== "text") continue;
      try {
        const parsed = resultSchema.safeParse(JSON.parse(part.text));
        if (!parsed.success) continue;
        const { capture, analysis, packet, packets, traffic } = parsed.data;
        for (const row of traffic?.evidence ?? packets ?? (packet ? [packet] : [])) {
          const { ref, frame } = row;
          if (
            ref &&
            frame.captureSha256 === capture.sha256 &&
            ref === captureCitation(capture, frame, analysis)
          )
            evidence.set(ref, { capture, frame, analysis });
        }
      } catch {
        // Plain text is never frame evidence.
      }
    }
  }
  return evidence;
}
