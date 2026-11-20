import { modelReferenceSchema, type SessionEvent } from "@vera/shared";

/** Session content follows agent policy; diagnostics always use the protected scrubber. */
export function sessionOutput(
  event: SessionEvent,
  content: (s: string) => string,
  protect: (s: string) => string,
): SessionEvent {
  const extra = (value: unknown, scrub = content): unknown =>
    typeof value === "string"
      ? scrub(value)
      : Array.isArray(value)
        ? value.map((item) => extra(item, scrub))
        : value && typeof value === "object"
          ? Object.fromEntries(Object.entries(value).map(([key, item]) => [scrub(key), extra(item, scrub)]))
          : value;
  const result = { ...event };
  for (const key of ["text", "title", "summary", "preview", "diff", "path", "name", "note"])
    if (typeof Reflect.get(result, key) === "string")
      Reflect.set(result, key, content(Reflect.get(result, key)));
  if (event.type === "error")
    Reflect.set(
      result,
      "messageKey",
      protect(event.messageKey) === event.messageKey ? event.messageKey : `errors.${event.code}`,
    );
  if (event.type === "session.updated" && event.modelRef !== undefined) {
    const model = event.modelRef === null ? null : content(event.modelRef);
    Reflect.set(
      result,
      "modelRef",
      model === null || modelReferenceSchema.safeParse(model).success ? model : "[REDACTED]/[REDACTED]",
    );
  }
  if (event.type === "tool.started") Reflect.set(result, "args", extra(event.args));
  if (event.type === "message.done")
    Reflect.set(
      result,
      "citations",
      event.citations.map((c) => ({ ...c, ref: content(c.ref) })),
    );
  if (event.type === "context.compacted") {
    Reflect.set(
      result,
      "refs",
      event.refs.map((ref) => content(ref)),
    );
    Reflect.set(
      result,
      "images",
      event.images.map((path) => content(path)),
    );
  }
  if (event.type === "todo.updated")
    Reflect.set(
      result,
      "items",
      event.items.map((item) => ({
        ...item,
        text: content(item.text),
        ...(item.id === undefined ? {} : { id: content(item.id) }),
      })),
    );
  if ((event.type === "tool.done" || event.type === "approval.requested") && event.program) {
    const p = event.program;
    Reflect.set(result, "program", {
      ...p,
      executable: content(p.executable),
      cwd: content(p.cwd),
      args: p.args.map(content),
      notes: p.notes.map(content),
      files: p.files.map((file) => ({ ...file, path: content(file.path) })),
      ...(p.directories ? { directories: p.directories.map((d) => ({ ...d, path: content(d.path) })) } : {}),
    });
  }
  return result;
}
