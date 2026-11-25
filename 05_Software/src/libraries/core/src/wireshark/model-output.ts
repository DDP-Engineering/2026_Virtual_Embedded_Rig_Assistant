import {
  type CapturePacket,
  captureAnalysisSchema,
  captureCoverageSchema,
  captureLimits,
  capturePacketSchema,
  captureQueryCursorSchema,
  captureReferenceSchema,
} from "@vera/shared";
import { z } from "zod";
import { capToolResult } from "../tools/registry.js";

const modelResult = z.looseObject({
  capture: captureReferenceSchema.optional(),
  analysis: captureAnalysisSchema.optional(),
  coverage: captureCoverageSchema.optional(),
  packet: capturePacketSchema.optional(),
  packets: z.array(capturePacketSchema).optional(),
  page: z
    .strictObject({
      querySha256: captureQueryCursorSchema.shape.querySha256,
      limit: z.number(),
      afterFrame: z.number(),
      next: captureQueryCursorSchema.nullable(),
    })
    .optional(),
  entries: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        transport: z.string().optional(),
      }),
    )
    .optional(),
  offset: z.number().optional(),
  total: z.number().optional(),
});

function maskPacket(packet: CapturePacket, scrub: (text: string) => string) {
  for (const values of Object.values(packet.fields)) {
    for (const [index, value] of values.entries()) {
      const masked = scrub(value);
      if (masked.length > captureLimits.valueChars) packet.truncated = true;
      values[index] = masked.slice(0, captureLimits.valueChars);
    }
  }
}

/** Apply agent masking to capture data before enforcing the final model-facing result budget. */
export function maskCaptureOutput(text: string, scrub: (text: string) => string, limit: number): string {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return scrub(text);
  }
  const parsed = modelResult.safeParse(decoded);
  if (!parsed.success) return scrub(text);
  const result = parsed.data;
  if (result.capture?.source.kind === "workbench")
    result.capture.source.path = scrub(result.capture.source.path).slice(0, 1024);
  if (result.analysis?.filter) result.analysis.filter = scrub(result.analysis.filter).slice(0, 1024);
  if (typeof result.error === "string") result.error = scrub(result.error);
  if (Array.isArray(result.entries)) {
    for (const entry of result.entries) entry.description = scrub(entry.description).slice(0, 160);
  }
  const packets = result.packets ?? (result.packet ? [result.packet] : []);
  for (const packet of packets) maskPacket(packet, scrub);
  if (result.coverage && packets.some((packet) => packet.truncated)) {
    result.coverage.partial = true;
    result.coverage.truncated = true;
  }
  let masked = JSON.stringify(result);
  if (result.coverage && masked.length > limit && packets.length) {
    result.coverage.partial = true;
    result.coverage.truncated = true;
    while (result.page && packets.length > 1 && masked.length > limit) {
      packets.pop();
      const last = packets.at(-1);
      if (!last) break;
      result.page.next = { querySha256: result.page.querySha256, afterFrame: last.frame.number };
      result.coverage.returned = packets.length;
      masked = JSON.stringify(result);
    }
    if (masked.length > limit && packets.length === 1) {
      const first = packets[0];
      if (first) {
        first.fields = {};
        first.truncated = true;
      }
      masked = JSON.stringify(result);
    }
  }
  if (result.entries && result.offset !== undefined) {
    while (result.entries.length > 1 && masked.length > limit) {
      result.entries.pop();
      result.nextOffset = result.offset + result.entries.length;
      masked = JSON.stringify(result);
    }
  }
  return masked.length <= limit ? masked : capToolResult(result, [], limit).text;
}
