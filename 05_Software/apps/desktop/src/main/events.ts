import {
  type EventEnvelope,
  eventEnvelopeSchema,
  modelReferenceSchema,
  type SessionState,
  type SessionSummary,
  type WorkbenchConfig,
  type WorkbenchWarning,
} from "@vera/shared";

function scrubExtra(value: unknown, scrub: (text: string) => string): unknown {
  if (typeof value === "string") return scrub(value);
  if (Array.isArray(value)) return value.map((item) => scrubExtra(item, scrub));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [scrub(key), scrubExtra(item, scrub)]),
    );
  return value;
}
function scrubModel(model: string | null, scrub: (text: string) => string): string | null {
  if (model === null) return null;
  const value = scrub(model);
  return modelReferenceSchema.safeParse(value).success ? value : "[REDACTED]/[REDACTED]";
}
export function sanitizeSessionSummary(
  summary: SessionSummary,
  scrub: (text: string) => string,
): SessionSummary {
  return {
    ...summary,
    title: scrub(summary.title).slice(0, 60),
    modelRef: scrubModel(summary.modelRef, scrub),
  };
}
export function sanitizeSessionSnapshot(
  snapshot: SessionState,
  scrub: (text: string) => string,
): SessionState {
  const state = structuredClone(snapshot);
  state.title = scrub(state.title).slice(0, 60);
  state.modelRef = scrubModel(state.modelRef, scrub);
  for (const item of state.items) {
    if (item.kind === "user" || item.kind === "assistant") item.text = scrub(item.text);
    if (item.kind === "assistant") item.citations = item.citations.map((c) => ({ ...c, ref: scrub(c.ref) }));
    if (item.kind === "tool") {
      item.name = scrub(item.name);
      item.args = scrubExtra(item.args, scrub);
      if (item.summary !== undefined) item.summary = scrub(item.summary);
      if (item.preview !== undefined) item.preview = scrub(item.preview);
    }
  }
  state.approvals = state.approvals.map((a) => ({ ...a, path: scrub(a.path), diff: scrub(a.diff) }));
  state.changes = state.changes.map((c) => ({ ...c, path: scrub(c.path) }));
  state.artifacts = state.artifacts.map((a) => ({ ...a, name: scrub(a.name) }));
  state.todos = state.todos.map((t) => ({ ...t, text: scrub(t.text) }));
  return state;
}

/** Preserve schema fields/identities; redact user text and arbitrary extension keys/values. */
function sanitizeEvent(envelope: EventEnvelope, scrub: (text: string) => string): EventEnvelope {
  const extra = (value: unknown): unknown => scrubExtra(value, scrub);
  const warnings = (items: WorkbenchWarning[]) =>
    items.map(({ code, path }) => ({ code, ...(path === undefined ? {} : { path: scrub(path) }) }));
  const configuration = (config: WorkbenchConfig): WorkbenchConfig => {
    const { format, id, name, description, docs, skills, tools, agent, ...extensions } = config;
    const { include, exclude, ...docExtensions } = docs;
    const { disabled: disabledSkills, ...skillExtensions } = skills;
    const { disabled: disabledTools, ...toolExtensions } = tools;
    const { permission_mode, model, ...agentExtensions } = agent;
    const scrubbedModel = model === null ? null : scrub(model);
    return {
      ...(extra(extensions) as Record<string, unknown>),
      format,
      id,
      name: scrub(name).slice(0, 80),
      ...(description === undefined ? {} : { description: scrub(description) }),
      docs: { ...(extra(docExtensions) as object), include: include.map(scrub), exclude: exclude.map(scrub) },
      skills: { ...(extra(skillExtensions) as object), disabled: disabledSkills.map(scrub) },
      tools: { ...(extra(toolExtensions) as object), disabled: disabledTools.map(scrub) },
      agent: {
        ...(extra(agentExtensions) as object),
        permission_mode,
        model:
          scrubbedModel === null || /^[^/]+\/.+$/.test(scrubbedModel)
            ? scrubbedModel
            : "[REDACTED]/[REDACTED]",
      },
    };
  };
  if (envelope.topic === "session") {
    const event = envelope.event;
    const result = { ...event };
    for (const key of ["text", "title", "summary", "preview", "diff", "path", "name"]) {
      if (key in result && typeof Reflect.get(result, key) === "string")
        Reflect.set(result, key, scrub(Reflect.get(result, key)));
    }
    if (event.type === "session.updated") {
      if (event.title !== undefined) Reflect.set(result, "title", scrub(event.title).slice(0, 60));
      if (event.modelRef !== undefined) Reflect.set(result, "modelRef", scrubModel(event.modelRef, scrub));
    }
    if (event.type === "tool.started") Reflect.set(result, "args", extra(event.args));
    if (event.type === "message.done")
      Reflect.set(
        result,
        "citations",
        event.citations.map((c) => ({ ...c, ref: scrub(c.ref) })),
      );
    if (event.type === "todo.updated")
      Reflect.set(
        result,
        "items",
        event.items.map((i) => ({ ...i, text: scrub(i.text) })),
      );
    return { ...envelope, event: result };
  }
  if (envelope.topic === "app" || envelope.event.type === "closed") return envelope;
  const event = envelope.event;
  return {
    ...envelope,
    event:
      event.type === "opened"
        ? {
            type: event.type,
            workbench: {
              ...event.workbench,
              folder: scrub(event.workbench.folder),
              config: configuration(event.workbench.config),
              warnings: warnings(event.workbench.warnings),
            },
          }
        : { type: event.type, config: configuration(event.config), warnings: warnings(event.warnings) },
  };
}

interface EventTarget {
  isDestroyed(): boolean;
  send(channel: string, envelope: EventEnvelope): void;
}

export function createEventEmitter(target: () => EventTarget | undefined, scrub?: (text: string) => string) {
  return (envelope: EventEnvelope): boolean => {
    const input = eventEnvelopeSchema.parse(envelope);
    const parsed = scrub ? eventEnvelopeSchema.parse(sanitizeEvent(input, scrub)) : input;
    const contents = target();
    if (!contents || contents.isDestroyed()) return false;
    contents.send("vera:event", parsed);
    return true;
  };
}

/** Call flush before emitting a terminal event; dispose cancels undelivered deltas. */
export function createDeltaCoalescer<T>(options: {
  key: (value: T) => string;
  merge: (previous: T, next: T) => T;
  emit: (value: T) => void;
}) {
  const pending = new Map<string, T>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  function flush() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const batch = [...pending.values()];
    pending.clear();
    for (const value of batch) options.emit(value);
  }
  return {
    push(value: T) {
      if (disposed) return;
      const key = options.key(value);
      const previous = pending.get(key);
      pending.set(key, previous === undefined ? value : options.merge(previous, value));
      if (timer === undefined) timer = setTimeout(flush, 50);
    },
    flush,
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending.clear();
    },
  };
}
