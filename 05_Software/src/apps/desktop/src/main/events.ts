import {
  boundSessionEvent,
  boundSessionState,
  commandPrefixSchema,
  type DocumentGuard,
  type EventEnvelope,
  eventEnvelopeSchema,
  modelReferenceSchema,
  type ProgramApproval,
  type SessionState,
  type SessionSummary,
  type TodoItem,
  type WorkbenchConfig,
  type WorkbenchWarning,
} from "@vera/shared";

/** Redacts a program approval's displayed strings; the confirmation word stays what core compares. */
function scrubProgram(program: ProgramApproval, scrub: (text: string) => string): ProgramApproval {
  return {
    ...program,
    executable: scrub(program.executable),
    args: program.args.map(scrub),
    cwd: scrub(program.cwd),
    notes: program.notes.map(scrub),
    files: program.files.map((file) => ({ ...file, path: scrub(file.path) })),
    ...(program.directories
      ? {
          directories: program.directories.map((directory) => ({
            ...directory,
            path: scrub(directory.path),
          })),
        }
      : {}),
  };
}
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
/** The count guard with its folder paths redacted, for the guard event and docs.volume. */
export function publicGuard(
  guard: DocumentGuard | null,
  scrub: (text: string) => string,
): DocumentGuard | null {
  return (
    guard && { ...guard, folders: guard.folders.map((folder) => ({ ...folder, path: scrub(folder.path) })) }
  );
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
function sanitizeTodos(items: TodoItem[], scrub: (text: string) => string): TodoItem[] {
  return items.map((item) => ({
    ...item,
    text: scrub(item.text).slice(0, 200),
    ...(item.id === undefined ? {} : { id: scrub(item.id) }),
  }));
}
type SessionItem = SessionState["items"][number];
function sanitizeItem(
  item: SessionItem,
  scrub: (text: string) => string,
  imagePath: (path: string) => string,
): SessionItem {
  if (item.kind === "user")
    return { ...item, text: scrub(item.text), ...(item.images && { images: item.images.map(imagePath) }) };
  if (item.kind === "assistant")
    return {
      ...item,
      text: scrub(item.text),
      citations: item.citations.map((c) => ({ ...c, ref: scrub(c.ref) })),
    };
  if (item.kind === "tool") {
    const tool = { ...item, name: scrub(item.name), args: scrubExtra(item.args, scrub) };
    if (tool.summary !== undefined) tool.summary = scrub(tool.summary);
    if (tool.preview !== undefined) tool.preview = scrub(tool.preview);
    return tool;
  }
  return item;
}
/**
 * Builds the scrubbed copy in one pass (PERF-05): only objects holding a scrubbed string are copied,
 * everything else is shared with the input, which is never written to. No full structuredClone.
 */
export function sanitizeSessionSnapshot(
  snapshot: SessionState,
  scrub: (text: string) => string,
  imagePath = scrub,
): SessionState {
  return {
    ...snapshot,
    title: scrub(snapshot.title).slice(0, 60),
    modelRef: scrubModel(snapshot.modelRef, scrub),
    items: snapshot.items.map((item) => sanitizeItem(item, scrub, imagePath)),
    approvals: snapshot.approvals.map((a) => ({
      ...a,
      path: scrub(a.path),
      diff: scrub(a.diff),
      ...(a.program ? { program: scrubProgram(a.program, scrub) } : {}),
    })),
    changes: snapshot.changes.map((c) => ({ ...c, path: scrub(c.path) })),
    artifacts: snapshot.artifacts.map((a) => ({ ...a, name: scrub(a.name) })),
    todos: sanitizeTodos(snapshot.todos, scrub),
  };
}

/** The snapshot main sends to the renderer: scrubbed first, then bounded (PERF-06), so no cut splits a secret. */
export function rendererSessionSnapshot(
  snapshot: SessionState,
  scrub: (text: string) => string,
  imagePath = scrub,
): SessionState {
  return boundSessionState(sanitizeSessionSnapshot(snapshot, scrub, imagePath));
}

/** Preserve schema fields/identities; redact user text and arbitrary extension keys/values. */
export function sanitizeEvent(
  envelope: EventEnvelope,
  scrub: (text: string) => string,
  protect = scrub,
  imagePath = scrub,
): EventEnvelope {
  const extra = (value: unknown): unknown => scrubExtra(value, scrub);
  const warnings = (items: WorkbenchWarning[]) =>
    items.map(({ code, path }) => ({ code, ...(path === undefined ? {} : { path: scrub(path) }) }));
  const configuration = (config: WorkbenchConfig): WorkbenchConfig => {
    const {
      format,
      privacy,
      id,
      name,
      description,
      additional_folders,
      docs,
      retrieval,
      skills,
      tools,
      plugins,
      chat,
      interface: panelInterface,
      agent,
      embeddings,
      ...extensions
    } = config;
    const { include, exclude, gitignore, maxFileMB, maxFiles, ...docExtensions } = docs;
    const { results, mode, ...retrievalExtensions } = retrieval;
    const { disabled: disabledSkills, ...skillExtensions } = skills;
    const { disabled: disabledTools, ...toolExtensions } = tools;
    const { enabled: enabledPlugins, ...pluginExtensions } = plugins;
    const { detail, ...chatExtensions } = chat;
    const { right_panel_tabs, ...interfaceExtensions } = panelInterface;
    const { permission_mode, model, allowed_commands, ...agentExtensions } = agent;
    const scrubbedModel = model === null ? null : scrub(model);
    return {
      ...(extra(extensions) as Record<string, unknown>),
      format,
      ...(privacy === undefined ? {} : { privacy }),
      id,
      name: scrub(name).slice(0, 80),
      additional_folders: additional_folders.filter((path) => scrub(path) === path),
      embeddings: { ...embeddings },
      ...(description === undefined ? {} : { description: scrub(description) }),
      docs: {
        ...(extra(docExtensions) as object),
        include: include.map(scrub),
        exclude: exclude.map(scrub),
        gitignore,
        ...(maxFileMB === undefined ? {} : { maxFileMB }),
        maxFiles,
      },
      retrieval: { ...(extra(retrievalExtensions) as object), results, mode },
      skills: { ...(extra(skillExtensions) as object), disabled: disabledSkills.map(scrub) },
      tools: { ...(extra(toolExtensions) as object), disabled: disabledTools.map(scrub) },
      plugins: { ...(extra(pluginExtensions) as object), enabled: enabledPlugins.map(scrub) },
      chat: { ...(extra(chatExtensions) as object), detail },
      interface: { ...(extra(interfaceExtensions) as object), right_panel_tabs },
      agent: {
        ...(extra(agentExtensions) as object),
        permission_mode,
        allowed_commands: allowed_commands
          .map(scrub)
          .filter((prefix) => commandPrefixSchema.safeParse(prefix).success),
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
    if (event.type === "error")
      Reflect.set(
        result,
        "messageKey",
        protect(event.messageKey) === event.messageKey ? event.messageKey : `errors.${event.code}`,
      );
    for (const key of ["text", "title", "summary", "preview", "diff", "path", "name"]) {
      if (key in result && typeof Reflect.get(result, key) === "string")
        Reflect.set(result, key, scrub(Reflect.get(result, key)));
    }
    if (event.type === "session.updated") {
      if (event.title !== undefined) Reflect.set(result, "title", scrub(event.title).slice(0, 60));
      if (event.modelRef !== undefined) Reflect.set(result, "modelRef", scrubModel(event.modelRef, scrub));
    }
    if ((event.type === "message.user" || event.type === "message.queued") && event.images)
      Reflect.set(result, "images", event.images.map(imagePath));
    if (event.type === "tool.started") Reflect.set(result, "args", extra(event.args));
    if ((event.type === "approval.requested" || event.type === "tool.done") && event.program)
      Reflect.set(result, "program", scrubProgram(event.program, scrub));
    if (event.type === "message.done")
      Reflect.set(
        result,
        "citations",
        event.citations.map((c) => ({ ...c, ref: scrub(c.ref) })),
      );
    if (event.type === "todo.updated") Reflect.set(result, "items", sanitizeTodos(event.items, scrub));
    return { ...envelope, event: result };
  }
  if (envelope.topic === "app") {
    const event = envelope.event;
    if (event.type === "update.available")
      return { ...envelope, event: { ...event, notes: scrub(event.notes) } };
    if (event.type === "update.changed")
      return {
        ...envelope,
        event: {
          ...event,
          snapshot: {
            ...event.snapshot,
            offer: event.snapshot.offer
              ? { ...event.snapshot.offer, notes: scrub(event.snapshot.offer.notes) }
              : null,
          },
        },
      };
    return envelope;
  }
  if (envelope.event.type === "closed") return envelope;
  const event = envelope.event;
  // Counters only: no paths or user text to scrub.
  if (event.type === "index.progress" || event.type === "index.volume") return envelope;
  if (event.type === "index.guard")
    return { ...envelope, event: { ...event, guard: publicGuard(event.guard, scrub) } };
  if (event.type === "index.document")
    return {
      ...envelope,
      event: {
        ...event,
        path: scrub(event.path),
        document: event.document ? { ...event.document, path: scrub(event.document.path) } : null,
      },
    };
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

export function createEventEmitter(
  target: () => EventTarget | undefined,
  scrub?: (text: string) => string,
  project?: (envelope: EventEnvelope) => EventEnvelope,
) {
  return (envelope: EventEnvelope): boolean => {
    const input = eventEnvelopeSchema.parse(envelope);
    const parsed = eventEnvelopeSchema.parse(
      project ? project(input) : scrub ? sanitizeEvent(input, scrub) : input,
    );
    const contents = target();
    if (!contents || contents.isDestroyed()) return false;
    // Session events reach the renderer bounded like its snapshot; stored events keep full content.
    let value = parsed;
    if (parsed.topic === "session") {
      const event = boundSessionEvent(parsed.event);
      if (event !== parsed.event) value = { ...parsed, event };
    }
    contents.send("vera:event", value);
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
