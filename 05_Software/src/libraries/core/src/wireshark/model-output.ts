import {
  automotiveLimits,
  type CapturePacket,
  captureAnalysisSchema,
  captureAutomotiveEvidenceSchema,
  captureCoverageSchema,
  captureLimits,
  captureNetworkingResultSchema,
  capturePacketSchema,
  captureQueryCursorSchema,
  captureReferenceSchema,
  captureTrafficFrameSchema,
  networkLimits,
  trafficPageCursorSchema,
} from "@vera/shared";
import { z } from "zod";
import { capToolResult } from "../tools/registry.js";
import { trimNetworkPage } from "./network-projection.js";

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

const address = z.looseObject({ address: z.string() });
const projectedAddresses = { a: address.optional(), b: address.optional(), endpoint: address.optional() };
const trafficResult = z.looseObject({
  summary: z.looseObject(projectedAddresses),
  summaryFrames: z.array(z.number().int()).max(9),
  rows: z
    .array(z.looseObject({ frames: z.array(z.number().int()).max(2), ...projectedAddresses }))
    .max(captureLimits.pageRows),
  evidence: z.array(captureTrafficFrameSchema).max(captureLimits.pageRows * 2 + 9),
  page: z.looseObject({
    querySha256: trafficPageCursorSchema.shape.querySha256,
    offset: z.number().int(),
    totalRows: z.number().int(),
    next: trafficPageCursorSchema.nullable(),
  }),
});

const automotiveResult = z.looseObject({
  selection: z.looseObject({
    addresses: z.array(z.string()).max(automotiveLimits.selectors),
  }),
  conversations: z
    .array(
      z.looseObject({
        id: z.number().int().positive(),
        a: address,
        b: address,
      }),
    )
    .max(captureLimits.pageRows + automotiveLimits.issueFrameSamples),
  scopeCoverage: z.looseObject({
    issueFrames: z.record(z.string(), z.number().int().positive()),
  }),
  rows: z
    .array(
      z.looseObject({
        conversation: z.number().int().positive(),
        frames: z.array(z.number().int().positive()).max(automotiveLimits.framesPerPdu),
      }),
    )
    .max(captureLimits.pageRows),
  evidence: captureAutomotiveEvidenceSchema,
  page: z.looseObject({
    querySha256: trafficPageCursorSchema.shape.querySha256,
    offset: z.number().int(),
    totalRows: z.number().int(),
    next: trafficPageCursorSchema.nullable(),
  }),
});

function maskAutomotive(
  result: z.infer<typeof modelResult>,
  coverage: NonNullable<z.infer<typeof modelResult>["coverage"]>,
  scrub: (text: string) => string,
  limit: number,
) {
  const parsed = automotiveResult.safeParse(result.automotive);
  if (!parsed.success) return JSON.stringify({ isError: true, reason: "automotive_projection_invalid" });
  const view = parsed.data;
  result.automotive = view;
  view.selection.addresses = view.selection.addresses.map((value) =>
    scrub(value).slice(0, captureLimits.valueChars),
  );
  for (const { a, b } of view.conversations) {
    a.address = scrub(a.address).slice(0, captureLimits.valueChars);
    b.address = scrub(b.address).slice(0, captureLimits.valueChars);
  }
  let masked = JSON.stringify(result);
  while (masked.length > limit && view.rows.length > 1) {
    view.rows.pop();
    const issueFrames = new Set(Object.values(view.scopeCoverage.issueFrames));
    const frames = new Set([...issueFrames, ...view.rows.flatMap((row) => row.frames)]);
    const groups = new Set([
      ...view.rows.map((row) => row.conversation),
      ...view.evidence
        .filter(({ frame }) => issueFrames.has(frame.number))
        .map(({ conversation }) => conversation),
    ]);
    view.evidence = view.evidence.filter(({ frame }) => frames.has(frame.number));
    view.conversations = view.conversations.filter(({ id }) => groups.has(id));
    view.page.next = { querySha256: view.page.querySha256, offset: view.page.offset + view.rows.length };
    coverage.returned = view.rows.length;
    coverage.partial = true;
    coverage.truncated = true;
    masked = JSON.stringify(result);
  }
  return masked.length <= limit ? masked : JSON.stringify({ isError: true, reason: "result_limit" });
}

function maskPacket(packet: CapturePacket, scrub: (text: string) => string) {
  for (const values of Object.values(packet.fields)) {
    for (const [index, value] of values.entries()) {
      const masked = scrub(value);
      if (masked.length > captureLimits.valueChars) packet.truncated = true;
      values[index] = masked.slice(0, captureLimits.valueChars);
    }
  }
}

function maskNetworking(decoded: unknown, scrub: (text: string) => string, limit: number) {
  const parsed = captureNetworkingResultSchema.safeParse(decoded);
  if (!parsed.success) return JSON.stringify({ isError: true, reason: "network_projection_invalid" });
  const result = parsed.data;
  const view = result.networking;
  const hideContext = view.evidenceMode === "compact";
  if (result.capture.source.kind === "workbench") {
    const masked = hideContext
      ? "[redacted]"
      : scrub(result.capture.source.path).slice(0, 1024) || "[redacted]";
    if (masked !== result.capture.source.path && !view.redactedContext.includes("capture.source.path"))
      view.redactedContext.push("capture.source.path");
    result.capture.source.path = masked;
  }
  if (result.analysis.filter) {
    const masked = hideContext ? "[redacted]" : scrub(result.analysis.filter).slice(0, 1024) || "[redacted]";
    if (masked !== result.analysis.filter && !view.redactedContext.includes("analysis.filter"))
      view.redactedContext.push("analysis.filter");
    result.analysis.filter = masked;
  }
  for (const row of view.rows) {
    for (const endpoint of row.kind === "conversation" ? [row.a, row.b] : [row.source, row.destination]) {
      if (!endpoint?.address) continue;
      const masked = scrub(endpoint.address);
      if (masked !== endpoint.address) endpoint.redacted = true;
      endpoint.address = masked.slice(0, networkLimits.valueChars) || null;
    }
    if (row.kind !== "observation") continue;
    const transactionId = row.exchange?.transactionId;
    if (row.exchange && transactionId && scrub(transactionId) !== transactionId)
      row.exchange.transactionId = null;
    for (const [field, originals] of Object.entries(row.fields)) {
      const masked = originals.map(scrub);
      if (masked.some((value, index) => value !== originals[index]) && !row.redactedFields.includes(field))
        row.redactedFields.push(field);
      if (masked.some((value) => value.length > networkLimits.valueChars)) row.valuesLimited = true;
      row.fields[field] = masked.map((value) => value.slice(0, networkLimits.valueChars));
    }
  }
  if (view.rows.some((row) => row.kind === "observation" && row.valuesLimited)) {
    result.coverage.partial = true;
    result.coverage.truncated = true;
  }
  let masked = JSON.stringify(result);
  while (masked.length > limit && trimNetworkPage(view, result.coverage)) masked = JSON.stringify(result);
  return masked.length <= limit ? masked : JSON.stringify({ isError: true, reason: "result_limit" });
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
  if (result.networking !== undefined && result.coverage) return maskNetworking(decoded, scrub, limit);
  if (result.capture?.source.kind === "workbench")
    result.capture.source.path = scrub(result.capture.source.path).slice(0, 1024);
  if (result.analysis?.filter) result.analysis.filter = scrub(result.analysis.filter).slice(0, 1024);
  if (typeof result.error === "string") result.error = scrub(result.error);
  if (result.automotive !== undefined && result.coverage)
    return maskAutomotive(result, result.coverage, scrub, limit);
  if (result.traffic !== undefined && result.coverage) {
    const traffic = trafficResult.safeParse(result.traffic);
    if (!traffic.success) return JSON.stringify({ isError: true, reason: "traffic_projection_invalid" });
    const view = traffic.data;
    result.traffic = view;
    for (const row of [view.summary, ...view.rows]) {
      for (const endpoint of [row.a, row.b, row.endpoint]) {
        if (endpoint) endpoint.address = scrub(endpoint.address).slice(0, captureLimits.valueChars);
      }
    }
    let masked = JSON.stringify(result);
    while (masked.length > limit && view.rows.length > 1) {
      view.rows.pop();
      const frames = new Set([...view.summaryFrames, ...view.rows.flatMap((row) => row.frames)]);
      view.evidence = view.evidence.filter((item) => frames.has(item.frame.number));
      view.page.next = { querySha256: view.page.querySha256, offset: view.page.offset + view.rows.length };
      result.coverage.returned = view.rows.length;
      result.coverage.partial = true;
      result.coverage.truncated = true;
      masked = JSON.stringify(result);
    }
    return masked.length <= limit ? masked : JSON.stringify({ isError: true, reason: "result_limit" });
  }
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
