import { z } from "zod";
import { type SessionEvent, usageEventSchema } from "./events.js";
import { permissionModeSchema, sessionStatusSchema, stopReasonSchema, todoItemsSchema } from "./session.js";

const assistant = z.strictObject({
  kind: z.literal("assistant"),
  id: z.string(),
  turnId: z.string().nullable(),
  text: z.string(),
  streaming: z.boolean(),
  citations: z.array(z.strictObject({ ref: z.string(), valid: z.boolean() })),
});
const tool = z.strictObject({
  kind: z.literal("tool"),
  id: z.string(),
  turnId: z.string().nullable(),
  name: z.string(),
  args: z.unknown(),
  status: z.enum(["running", "ok", "error"]),
  summary: z.string().optional(),
  preview: z.string().optional(),
  durationMs: z.number().optional(),
});
export const sessionStateSchema = z.strictObject({
  title: z.string(),
  status: sessionStatusSchema,
  modelRef: z.string().nullable(),
  mode: permissionModeSchema,
  activeTurnId: z.string().nullable(),
  interrupted: z.array(z.string()),
  items: z.array(
    z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("user"), id: z.string(), text: z.string() }),
      assistant,
      tool,
      z.strictObject({
        kind: z.literal("error"),
        id: z.string(),
        code: z.string(),
        messageKey: z.string(),
        retryable: z.boolean(),
      }),
    ]),
  ),
  turns: z.array(
    z.strictObject({ turnId: z.string(), steps: z.number(), stopReason: stopReasonSchema.nullable() }),
  ),
  approvals: z.array(
    z.strictObject({
      approvalId: z.string(),
      callId: z.string(),
      requestSha256: z.string(),
      tool: z.enum(["write", "edit"]),
      path: z.string(),
      diff: z.string(),
      bytes: z.number(),
      decision: z.enum(["approved", "denied", "aborted"]).nullable(),
      by: z.enum(["user", "mode"]).optional(),
    }),
  ),
  changes: z.array(
    z.strictObject({ changeId: z.number(), path: z.string(), added: z.number(), removed: z.number() }),
  ),
  artifacts: z.array(z.strictObject({ artifactId: z.string(), name: z.string(), bytes: z.number() })),
  todos: todoItemsSchema,
  usage: usageEventSchema.omit({ type: true }),
});
export type SessionState = z.infer<typeof sessionStateSchema>;
export function emptySessionState(): SessionState {
  return {
    title: "",
    status: "idle",
    modelRef: null,
    mode: "ask",
    activeTurnId: null,
    interrupted: [],
    items: [],
    turns: [],
    approvals: [],
    changes: [],
    artifacts: [],
    todos: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}
/** Pure shared projection. Terminal messages are authoritative even when deltas were missed. */
export function applySessionEvent(state: SessionState, input: SessionEvent): SessionState {
  const event: SessionEvent = JSON.parse(JSON.stringify(input));
  const s: SessionState = JSON.parse(JSON.stringify(state));
  const turnId = s.activeTurnId;
  switch (event.type) {
    case "session.updated": {
      const { type: _, ...fields } = event;
      Object.assign(s, fields);
      break;
    }
    case "session.interrupted":
      s.interrupted.push(event.turnId);
      break;
    case "turn.started":
      s.activeTurnId = event.turnId;
      s.status = "running";
      s.turns.push({ turnId: event.turnId, steps: 0, stopReason: null });
      break;
    case "turn.done":
      s.activeTurnId = null;
      s.status = event.stopReason === "error" ? "error" : "idle";
      for (const t of s.turns) if (t.turnId === event.turnId) t.stopReason = event.stopReason;
      s.items = s.items.filter((item) => item.kind !== "assistant" || !item.streaming);
      for (const i of s.items) {
        if (i.kind === "assistant") i.streaming = false;
        if (i.kind === "tool" && i.status === "running") {
          i.status = "error";
          i.summary = "Interrupted.";
        }
      }
      break;
    case "message.user":
      if (!s.items.some((i) => i.id === event.messageId))
        s.items.push({ kind: "user", id: event.messageId, text: event.text });
      break;
    case "reasoning.delta":
      break; // ephemeral reasoning has no durable projection
    case "message.delta": {
      let i = s.items.find((i) => i.kind === "assistant" && i.id === event.messageId);
      if (!i) {
        i = { kind: "assistant", id: event.messageId, turnId, text: "", streaming: true, citations: [] };
        s.items.push(i);
      }
      if (i.kind === "assistant") i.text += event.text;
      break;
    }
    case "message.done": {
      const item = {
        kind: "assistant" as const,
        id: event.messageId,
        turnId,
        text: event.text,
        streaming: false,
        citations: event.citations,
      };
      const index = s.items.findIndex((i) => i.kind === "assistant" && i.id === event.messageId);
      if (index < 0) s.items.push(item);
      else s.items[index] = item;
      break;
    }
    case "tool.started":
      s.items.push({
        kind: "tool",
        id: event.callId,
        turnId,
        name: event.name,
        args: event.args,
        status: "running",
      });
      for (const t of s.turns) if (t.turnId === turnId) t.steps++;
      break;
    case "tool.update":
      break;
    case "tool.done": {
      const i = s.items.find((i) => i.kind === "tool" && i.id === event.callId);
      if (i?.kind === "tool") {
        i.status = event.ok ? "ok" : "error";
        i.summary = event.summary;
        i.durationMs = event.durationMs;
        if (event.preview !== undefined) i.preview = event.preview;
      }
      break;
    }
    case "approval.requested": {
      const { type: _, ...a } = event;
      s.approvals.push({ ...a, decision: null });
      s.status = "awaiting_approval";
      break;
    }
    case "approval.decided": {
      const a = s.approvals.find((a) => a.approvalId === event.approvalId);
      if (a) {
        a.decision = event.decision;
        a.by = event.by;
      }
      s.status = s.activeTurnId ? "running" : "idle";
      break;
    }
    case "change.recorded": {
      const { type: _, ...c } = event;
      s.changes.push(c);
      break;
    }
    case "artifact.saved": {
      const { type: _, ...a } = event;
      s.artifacts.push(a);
      break;
    }
    case "todo.updated":
      s.todos = event.items;
      break;
    case "usage.updated": {
      const { type: _, ...u } = event;
      s.usage = { ...s.usage, ...u };
      break;
    }
    case "error": {
      const { type: _, ...e } = event;
      s.items.push({ kind: "error", id: `error-${s.items.filter((i) => i.kind === "error").length}`, ...e });
      break;
    }
  }
  return s;
}
