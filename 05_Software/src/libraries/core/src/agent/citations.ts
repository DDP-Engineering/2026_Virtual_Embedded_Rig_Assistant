import type { Message } from "@earendil-works/pi-ai";
import { decodeRegisterResultSchema, parseRef } from "@vera/shared";
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
/**
 * A tool issued `ref` itself, or `ref` is a line range inside a line window issued for the same file: the
 * model read those lines and may cite only the part it used.
 */
export function withinIssued(ref: string, issued: ReadonlySet<string>): boolean {
  if (issued.has(ref)) return true;
  const cited = parseRef(ref);
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
/** Only successful parse_log provenance admits UTF8 logs containing control bytes. */
export function issuedLogRefs(messages: readonly Message[]): Set<string> {
  const issued = new Set<string>();
  for (const message of messages)
    if (message.role === "toolResult" && message.toolName === "parse_log" && !message.isError)
      for (const block of message.content)
        if (block.type === "text") {
          try {
            refs(JSON.parse(block.text), issued);
          } catch {
            /* plain text issues no refs */
          }
        }
  return issued;
}
export async function validateCitations(
  root: string,
  text: string,
  messages: readonly Message[],
  artifactExists?: (name: string) => boolean,
  validDocumentRef?: (ref: string) => Promise<boolean>,
  captureNavigation?: CaptureNavigationLookup,
) {
  const issued = new Set<string>();
  const logs = issuedLogRefs(messages);
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
  for (const message of messages)
    if (message.role === "toolResult" && !message.isError && message.toolName !== "wireshark_capture")
      for (const block of message.content)
        if (block.type === "text") {
          try {
            const value: unknown = JSON.parse(block.text);
            refs(value, issued);
            if (message.toolName === "decode_register") {
              const decoded = decodeRegisterResultSchema.safeParse(value);
              if (decoded.success) for (const ref of decoded.data.sourceRefs) issued.add(ref);
            }
          } catch {
            /* refs originate structured tool fields */
          }
        }
  const found = [
    ...new Set(Array.from(text.matchAll(/\[\[([^\]]+)\]\]/g), (match) => match[0].slice(2, -2))),
  ];
  const captures = found.some((ref) => ref.startsWith("capture:"))
    ? issuedCaptureCitations(messages, captureNavigation)
    : undefined;
  let guard: PathGuard;
  try {
    guard = await PathGuard.create(root);
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
          if (parsed.kind === "artifact") valid = !!artifactExists?.(parsed.name);
          // Help pages ship with the application; the help tool issued this ref.
          else if (parsed.kind === "help") valid = help.has(ref);
          else if (parsed.kind === "lines") {
            const window = await readWindow(
              guard,
              parsed.path,
              parsed.start,
              1,
              new AbortController().signal,
              { utf8Log: withinIssued(ref, logs) },
            );
            valid = parsed.end <= window.totalLines;
          } else valid = !!(await validDocumentRef?.(ref));
        } catch {
          /* removed/ignored/binary/outside source is unresolved */
        }
      return { ref, valid };
    }),
  );
}
