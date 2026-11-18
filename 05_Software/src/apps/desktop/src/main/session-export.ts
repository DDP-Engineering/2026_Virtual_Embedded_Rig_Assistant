// REQ-SEC-17075aa1 REQ-FUNC-70479d66
import { buildSessionMarkdown, type SessionService } from "@vera/core";
import { type SessionExportFormat, sessionExportSchema } from "@vera/shared";
import { exportDestination } from "./artifacts.js";
import { sanitizeEvent, sanitizeSessionSummary } from "./events.js";

/** Called within SessionsHost.run; the desktop picks the path before it queues, so `choose` returns at once. */
export async function exportSession(
  service: SessionService,
  id: string,
  format: SessionExportFormat,
  options: {
    root: string;
    choose(name: string): Promise<string | null>;
    write(path: string, content: string): Promise<void>;
    scrub(text: string): string;
    masking?(): boolean;
  },
): Promise<{ exported: boolean }> {
  service.get(id);
  const path = await options.choose(`${id}.${format}`);
  if (path === null) return { exported: false };
  const target = exportDestination(options.root, path);
  const scrub = (text: string) => (options.masking?.() === false ? text : options.scrub(text));
  const source = service.exportSession(id);
  const data = sessionExportSchema.parse({
    ...source,
    session: sanitizeSessionSummary(source.session, scrub),
    events: source.events.map((row) => {
      const envelope = sanitizeEvent({ topic: "session", id, event: row.event }, scrub, options.scrub);
      return { ...row, event: envelope.event };
    }),
  });
  const content =
    format === "json"
      ? `${JSON.stringify(data, null, 2)}\n`
      : buildSessionMarkdown(
          data,
          service.listChanges(id).map((change) => {
            const detail = service.getChange(change.changeId);
            return { ...detail, path: scrub(detail.path), diff: scrub(detail.diff) };
          }),
        );
  await options.write(target, content);
  return { exported: true };
}
