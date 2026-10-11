import {
  type EventEnvelope,
  eventEnvelopeSchema,
  type WorkbenchConfig,
  type WorkbenchWarning,
} from "@vera/shared";

/** Preserve schema fields/identities; redact user text and arbitrary extension keys/values. */
function sanitizeEvent(envelope: EventEnvelope, scrub: (text: string) => string): EventEnvelope {
  const extra = (value: unknown): unknown => {
    if (typeof value === "string") return scrub(value);
    if (Array.isArray(value)) return value.map(extra);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [scrub(key), extra(item)]));
    return value;
  };
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
