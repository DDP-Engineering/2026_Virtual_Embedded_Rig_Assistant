import { createHash } from "node:crypto";
import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  type CaptureAnalysis,
  type CaptureFrameReference,
  type CaptureReference,
  captureAnalysisSchema,
  captureAutomotiveEvidenceSchema,
  captureFrameReferenceSchema,
  captureLimits,
  captureNetworkingEvidenceSchema,
  captureNetworkingResultSchema,
  capturePacketSchema,
  captureReferenceSchema,
  captureTrafficFrameSchema,
  formatRef,
} from "@vera/shared";
import { z } from "zod";

const contextSchema = z.strictObject({ capture: captureReferenceSchema, analysis: captureAnalysisSchema });
export type CaptureNavigationContext = z.infer<typeof contextSchema>;
export type CaptureNavigationLookup = (toolCallId: string) => CaptureNavigationContext | undefined;

const resultSchema = z.object({
  capture: captureReferenceSchema,
  analysis: captureAnalysisSchema,
  packet: capturePacketSchema.optional(),
  packets: z.array(capturePacketSchema).max(captureLimits.pageRows).optional(),
  traffic: z
    .object({ evidence: z.array(captureTrafficFrameSchema).max(captureLimits.pageRows * 2 + 9) })
    .optional(),
  automotive: z.object({ evidence: captureAutomotiveEvidenceSchema }).optional(),
  networking: z.object({ evidence: captureNetworkingEvidenceSchema }).optional(),
});

/** Retain the exact local locator before publication applies the agent mask. */
export function networkingCitationContext(text: string): CaptureNavigationContext | undefined {
  try {
    const result = captureNetworkingResultSchema.safeParse(JSON.parse(text)).data;
    if (result?.analysis.networkProfile && result.networking.evidence.length)
      return { capture: result.capture, analysis: result.analysis };
  } catch {
    // Unstructured output cannot furnish local navigation context.
  }
  return undefined;
}

type StoredToolResult = ToolResultMessage & { networkCaptureContext?: unknown };

export function storedNetworkingCitationContext(text: string): CaptureNavigationContext | undefined {
  try {
    const message = JSON.parse(text) as StoredToolResult;
    if (message.role === "toolResult" && message.toolName === "wireshark_capture" && !message.isError)
      return contextSchema.safeParse(message.networkCaptureContext).data;
  } catch {
    // Corrupted private context cannot resolve a reference.
  }
  return undefined;
}

/** Project the public tool message from the private tool invocation record. */
export function publicToolResult(text: string): ToolResultMessage {
  const message = JSON.parse(text) as StoredToolResult;
  delete message.networkCaptureContext;
  return message;
}

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
export function issuedCaptureCitations(messages: readonly Message[], lookup?: CaptureNavigationLookup) {
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
        const { packet, packets, traffic, automotive, networking } = parsed.data;
        const { capture, analysis } = (networking && lookup?.(message.toolCallId)) || parsed.data;
        if (capture.sha256 !== parsed.data.capture.sha256) continue;
        for (const row of networking?.evidence ??
          automotive?.evidence ??
          traffic?.evidence ??
          packets ??
          (packet ? [packet] : [])) {
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
