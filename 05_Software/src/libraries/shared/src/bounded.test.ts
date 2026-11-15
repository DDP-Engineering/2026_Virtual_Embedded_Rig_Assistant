// REQ-FUNC-a8ca0721
import { describe, expect, it } from "vitest";
import {
  ARGS_INLINE_BYTES,
  applySessionEvent,
  boundSessionEvent,
  boundSessionState,
  channels,
  cutUtf8,
  emptySessionState,
  foldSessionEvents,
  PREVIEW_INLINE_BYTES,
  type SessionEvent,
  sessionEventSchema,
  sessionStateSchema,
} from "./index.js";

const utf8 = (text: string) => encodeURIComponent(text).replace(/%[0-9A-F]{2}/g, "x").length;

describe("cutUtf8", () => {
  it("cuts at the byte limit and reports the full size", () => {
    expect(PREVIEW_INLINE_BYTES).toBe(8192);
    expect(ARGS_INLINE_BYTES).toBe(4096);
    const cut = cutUtf8("a".repeat(65536), PREVIEW_INLINE_BYTES);
    expect(cut).toEqual({ text: "a".repeat(8192), totalBytes: 65536 });
  });
  it("leaves text at or below the limit unchanged", () => {
    expect(cutUtf8("a".repeat(8192), 8192)).toBeUndefined();
    expect(cutUtf8("board ready", 8192)).toBeUndefined();
    expect(cutUtf8("€".repeat(2730), 8192)).toBeUndefined(); // 8,190 bytes
  });
  it("never splits a multi-byte character at the boundary", () => {
    const euro = `${"a".repeat(8191)}€tail`;
    expect(cutUtf8(euro, 8192)).toEqual({ text: "a".repeat(8191), totalBytes: utf8(euro) });
    const emoji = `${"a".repeat(8190)}😀b`;
    const cut = cutUtf8(emoji, 8192);
    expect(cut).toEqual({ text: "a".repeat(8190), totalBytes: utf8(emoji) });
    const mixed = "ăîșț😀€a".repeat(2000);
    const part = cutUtf8(mixed, 8192);
    expect(part && utf8(part.text)).toBeLessThanOrEqual(8192);
    expect(part && mixed.startsWith(part.text)).toBe(true);
    expect(part?.text.at(-1)).not.toMatch(/[\uD800-\uDBFF]/);
    expect(part?.totalBytes).toBe(utf8(mixed));
  });
});

const events: SessionEvent[] = [
  { type: "tool.started", callId: "big", name: "read", args: { path: "a", body: "x".repeat(5000) } },
  { type: "tool.done", callId: "big", ok: true, summary: "s", preview: "y".repeat(65536), durationMs: 1 },
  { type: "tool.started", callId: "small", name: "read", args: { path: "b" } },
  { type: "tool.done", callId: "small", ok: true, summary: "s", preview: "board ready", durationMs: 1 },
  {
    type: "approval.requested",
    approvalId: "apv",
    callId: "big",
    requestSha256: "0".repeat(64),
    tool: "write",
    path: "a.txt",
    diff: "+".repeat(9000),
    bytes: 9000,
  },
];

describe("boundSessionState", () => {
  it("bounds previews, args and diffs and keeps small items as they are", () => {
    const state = foldSessionEvents(events);
    const bounded = sessionStateSchema.parse(boundSessionState(state));
    const [big, small] = bounded.items;
    const argsJson = JSON.stringify(events[0]?.type === "tool.started" ? events[0].args : null);
    expect(big).toMatchObject({
      preview: "y".repeat(8192),
      args: argsJson.slice(0, 4096),
      truncated: { preview: 65536, args: argsJson.length },
    });
    expect(small).toEqual(state.items[1]);
    expect(small).not.toHaveProperty("truncated");
    expect(bounded.approvals[0]).toMatchObject({ diff: "+".repeat(8192), truncated: { diff: 9000 } });
    // Small items keep their identity; the input is not written to.
    expect(boundSessionState(state).items[1]).toBe(state.items[1]);
    expect(state.items[0]).toMatchObject({ preview: "y".repeat(65536) });
    expect(state.items[0]).not.toHaveProperty("truncated");
  });
  it("returns the same state when nothing is cut", () => {
    const state = foldSessionEvents(events.slice(2, 4));
    expect(boundSessionState(state)).toBe(state);
  });
});

describe("boundSessionEvent", () => {
  it("bounds large events into the same shape the bounded snapshot has", () => {
    let live = emptySessionState();
    for (const event of events) {
      const bounded = sessionEventSchema.parse(boundSessionEvent(event));
      live = applySessionEvent(live, bounded);
    }
    expect(live).toEqual(boundSessionState(foldSessionEvents(events)));
    const small = events[3] as SessionEvent;
    expect(boundSessionEvent(small)).toBe(small);
  });
});

// REQ-FUNC-acaeb296 REQ-SEC-bde59b0b
it("validates session.item.detail requests and responses", () => {
  const { request, response } = channels["session.item.detail"];
  const sessionId = "ses_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
  for (const field of ["preview", "args", "diff"])
    expect(request.safeParse({ sessionId, itemId: "call_1", field }).success).toBe(true);
  expect(request.safeParse({ sessionId, itemId: "call_1", field: "summary" }).success).toBe(false);
  expect(request.safeParse({ sessionId, itemId: "", field: "preview" }).success).toBe(false);
  expect(request.safeParse({ sessionId: "other", itemId: "call_1", field: "preview" }).success).toBe(false);
  expect(response.safeParse({ text: "full" }).success).toBe(true);
  expect(response.safeParse({ text: "full", extra: 1 }).success).toBe(false);
});
