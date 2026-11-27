import type { Message } from "@earendil-works/pi-ai";
import {
  decodeRegisterResultSchema,
  type LineRef,
  parseLineRef,
  parseLogResultSchema,
  parseRef,
} from "@vera/shared";
import { readWindow } from "../tools/read-window.js";
import { type CaptureNavigationLookup, issuedCaptureCitations } from "../wireshark/citations.js";
import { PathGuard } from "../workbench/path-guard.js";

function refs(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) for (const child of value) refs(child, out);
  else if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) {
      if (key === "ref" && typeof child === "string") out.add(child);
      refs(child, out);
    }
}

/** Collect references from successful structured tool results, never from prose. */
export function addIssuedCitationRefs(message: Message, issued: Set<string>): void {
  if (
    message.role !== "toolResult" ||
    message.isError ||
    message.toolName === "wireshark_capture" ||
    message.toolName === "artifact_list"
  )
    return;
  for (const block of message.content) {
    if (block.type !== "text") continue;
    try {
      const value: unknown = JSON.parse(block.text);
      refs(value, issued);
      if (message.toolName === "decode_register") {
        const decoded = decodeRegisterResultSchema.safeParse(value);
        if (decoded.success) for (const ref of decoded.data.sourceRefs) issued.add(ref);
      }
    } catch {
      // Unstructured text cannot issue references.
    }
  }
}

/** Keep exact citations and replace covered subranges with the narrowest tool-issued line window. */
export function exactIssuedLineCitations(content: string, issued: ReadonlySet<string>): string {
  const windows = [...issued]
    .flatMap((ref) => {
      const range = parseRef(ref);
      return range?.kind === "lines" ? [{ ...range, ref }] : [];
    })
    .sort((a, b) => a.end - a.start - (b.end - b.start) || a.start - b.start);
  if (!windows.length) return content;
  return content.replace(/\[\[([^\]\r\n]*)(\]\])?/g, (citation, ref: string, close: string | undefined) => {
    if (!close) return citation;
    const range = parseRef(ref);
    if (range?.kind !== "lines" || issued.has(ref)) return citation;
    const window = windows.find(
      (item) => item.path === range.path && item.start <= range.start && item.end >= range.end,
    );
    return window ? `[[${window.ref}]]` : citation;
  });
}
/**
 * A tool issued `ref` itself, or `ref` is a line range inside a line window issued for the same file: the
 * model read those lines and may cite only the part it used.
 */
export function withinIssued(ref: string, issued: ReadonlySet<string>): boolean {
  if (issued.has(ref)) return true;
  const cited = parseRef(ref);
  if (cited?.kind === "page" || cited?.kind === "page-range") {
    // The model read pages 45-47 and cites page 46: that page was issued too.
    const start = cited.kind === "page" ? cited.page : cited.start;
    const end = cited.kind === "page" ? cited.page : cited.end;
    for (const candidate of issued) {
      const window = parseRef(candidate);
      if (
        window?.kind === "page-range" &&
        window.path === cited.path &&
        window.start <= start &&
        end <= window.end
      )
        return true;
    }
    return false;
  }
  if (cited?.kind !== "lines") return false;
  for (const candidate of issued) {
    const window = parseRef(candidate);
    if (
      window?.kind === "lines" &&
      window.path === cited.path &&
      window.start <= cited.start &&
      cited.end <= window.end
    )
      return true;
  }
  return false;
}
function issuedLogSources(messages: readonly Message[]) {
  const issued: (LineRef & { sha256: string | null; bytes: number | undefined })[] = [];
  for (const message of messages)
    if (message.role === "toolResult" && message.toolName === "parse_log" && !message.isError)
      for (const block of message.content)
        if (block.type === "text") {
          try {
            const value = JSON.parse(block.text);
            const source = parseLogResultSchema.shape.source.safeParse(value?.source).data;
            const scan = parseLogResultSchema.shape.scan.safeParse(value?.scan).data;
            const range = source?.ref ? parseLineRef(source.ref) : undefined;
            // The hash is of the bytes analysed: a log that grew afterwards still holds them unchanged.
            if (range && range.path === source?.path)
              issued.push({ ...range, sha256: source.sha256, bytes: scan?.bytes });
          } catch {
            /* plain text issues no refs */
          }
        }
  return issued;
}

function coveringLogSource(sources: ReturnType<typeof issuedLogSources>, range: LineRef) {
  return sources.findLast(
    (source) => source.path === range.path && source.start <= range.start && source.end >= range.end,
  );
}

/** Resolve the most recent issued log revision that covers the citation. */
export function citationLogSource(ref: string, messages: readonly Message[]) {
  const range = parseLineRef(ref);
  return range && coveringLogSource(issuedLogSources(messages), range);
}
export async function validateCitations(
  root: string,
  text: string,
  messages: readonly Message[],
  artifactExists?: (name: string) => boolean | Promise<boolean>,
  validDocumentRef?: (ref: string) => Promise<boolean>,
  captureNavigation?: CaptureNavigationLookup,
) {
  const issued = new Set<string>();
  const logs = issuedLogSources(messages);
  // Help refs count only when the help tool itself returned them.
  const help = new Set<string>();
  for (const message of messages)
    if (message.role === "toolResult" && message.toolName === "help" && !message.isError)
      for (const block of message.content)
        if (block.type === "text")
          try {
            refs(JSON.parse(block.text), help);
          } catch {
            /* plain text issues no refs */
          }
  for (const message of messages) addIssuedCitationRefs(message, issued);
  const found = [
    ...new Set(Array.from(text.matchAll(/\[\[([^\]]+)\]\]/g), (match) => match[0].slice(2, -2))),
  ];
  const captures = found.some((ref) => ref.startsWith("capture:"))
    ? issuedCaptureCitations(messages, captureNavigation)
    : undefined;
  let guard: PathGuard;
  try {
    guard = await PathGuard.create(root, root, "workbench", undefined, [], [], { allowRunLogs: true });
  } catch {
    return found.map((ref) => ({ ref, valid: false }));
  }
  return Promise.all(
    found.map(async (ref) => {
      const parsed = parseRef(ref);
      let valid = false;
      if (parsed?.kind === "capture") valid = captures?.has(ref) ?? false;
      else if (parsed && withinIssued(ref, issued))
        try {
          if (parsed.kind === "artifact") valid = !!(await artifactExists?.(parsed.name));
          // Help pages ship with the application; the help tool issued this ref.
          else if (parsed.kind === "help") valid = help.has(ref);
          else if (parsed.kind === "lines") {
            const log = coveringLogSource(logs, parsed);
            const window = await readWindow(
              guard,
              parsed.path,
              parsed.start,
              1,
              new AbortController().signal,
              log ? { utf8Log: true, allowGrowth: true, prefixBytes: log.bytes } : {},
            );
            valid =
              parsed.end <= window.totalLines &&
              (!log?.sha256 || log.sha256 === (window.prefixSha256 ?? window.sha256));
          } else valid = !!(await validDocumentRef?.(ref));
        } catch {
          /* removed/ignored/binary/outside source is unresolved */
        }
      return { ref, valid };
    }),
  );
}
