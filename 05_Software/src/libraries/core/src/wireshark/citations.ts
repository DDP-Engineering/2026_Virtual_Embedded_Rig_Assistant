import { createHash } from "node:crypto";
import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  type CaptureAnalysis,
  type CaptureFrameReference,
  type CaptureReference,
  captureAnalysisSchema,
  captureAutomotiveEvidenceSchema,
  captureComparisonResultSchema,
  captureFrameReferenceSchema,
  captureLimits,
  captureMediaEvidenceSchema,
  captureMediaResultSchema,
  captureNetworkingEvidenceSchema,
  captureNetworkingResultSchema,
  capturePacketSchema,
  captureReferenceSchema,
  captureTrafficFrameSchema,
  formatRef,
} from "@vera/shared";
import { z } from "zod";
import { comparisonEvidence } from "./comparison-report.js";

const contextSchema = z.strictObject({ capture: captureReferenceSchema, analysis: captureAnalysisSchema });
const comparisonContext = z.strictObject({ baseline: contextSchema, candidate: contextSchema });
const privateContext = z.union([contextSchema, comparisonContext]);
export type CaptureNavigationContext = z.infer<typeof privateContext>;
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
  media: z.object({ evidence: captureMediaEvidenceSchema }).optional(),
});

/** Retain the exact local locator before publication applies the agent mask. */
export function networkingCitationContext(text: string): CaptureNavigationContext | undefined {
  try {
    const decoded: unknown = JSON.parse(text);
    const comparison = captureComparisonResultSchema.safeParse(decoded).data;
    if (comparison && comparisonEvidence(comparison.comparison).some(({ frames }) => frames.length)) {
      return {
        baseline: { capture: comparison.comparison.baseline.capture, analysis: comparison.analysis },
        candidate: { capture: comparison.comparison.candidate.capture, analysis: comparison.analysis },
      };
    }
    const result = captureNetworkingResultSchema.safeParse(decoded).data;
    if (result?.analysis.networkProfile && result.networking.evidence.length)
      return { capture: result.capture, analysis: result.analysis };
    const media = captureMediaResultSchema.safeParse(decoded).data;
    if (media?.analysis.mediaProfile && media.media.evidence.length)
      return { capture: media.capture, analysis: media.analysis };
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
      return privateContext.safeParse(message.networkCaptureContext).data;
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
  function add(
    { ref, frame }: { ref?: string | undefined; frame: CaptureFrameReference },
    { capture, analysis }: z.infer<typeof contextSchema>,
  ) {
    if (ref && frame.captureSha256 === capture.sha256 && ref === captureCitation(capture, frame, analysis))
      evidence.set(ref, { capture, frame, analysis });
  }
  for (const message of messages) {
    if (message.role !== "toolResult" || message.toolName !== "wireshark_capture" || message.isError)
      continue;
    for (const part of message.content) {
      if (part.type !== "text") continue;
      try {
        const decoded: unknown = JSON.parse(part.text);
        const projected = captureComparisonResultSchema.safeParse(decoded).data;
        if (projected) {
          const context = lookup?.(message.toolCallId);
          for (const { side, frames } of comparisonEvidence(projected.comparison)) {
            const source = projected.comparison[side].capture;
            const locator =
              context && "baseline" in context
                ? context[side]
                : { capture: source, analysis: projected.analysis };
            if (locator.capture.sha256 !== source.sha256) continue;
            for (const frame of frames) add(frame, locator);
          }
          continue;
        }
        const parsed = resultSchema.safeParse(decoded);
        if (!parsed.success) continue;
        const { packet, packets, traffic, automotive, networking, media } = parsed.data;
        const context = networking || media ? lookup?.(message.toolCallId) : undefined;
        const { capture, analysis } = context && "capture" in context ? context : parsed.data;
        if (capture.sha256 !== parsed.data.capture.sha256) continue;
        for (const row of media?.evidence ??
          networking?.evidence ??
          automotive?.evidence ??
          traffic?.evidence ??
          packets ??
          (packet ? [packet] : [])) {
          add(row, { capture, analysis });
        }
      } catch {
        // Plain text is never frame evidence.
      }
    }
  }
  return evidence;
}
