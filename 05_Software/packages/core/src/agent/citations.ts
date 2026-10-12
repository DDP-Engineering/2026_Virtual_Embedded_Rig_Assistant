import type { Message } from "@earendil-works/pi-ai";
import { parseArtifactRef, parseLineRef } from "@vera/shared";
import { readWindow } from "../tools/read-window.js";
import { PathGuard } from "../workbench/path-guard.js";

function refs(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) for (const child of value) refs(child, out);
  else if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) {
      if (key === "ref" && typeof child === "string") out.add(child);
      refs(child, out);
    }
}
export async function validateCitations(
  root: string,
  text: string,
  messages: readonly Message[],
  artifactExists?: (name: string) => boolean,
) {
  const issued = new Set<string>();
  for (const message of messages)
    if (message.role === "toolResult" && !message.isError)
      for (const block of message.content)
        if (block.type === "text") {
          try {
            refs(JSON.parse(block.text), issued);
          } catch {
            /* refs originate structured tool fields */
          }
        }
  const found = [...new Set([...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]!))];
  let guard: PathGuard;
  try {
    guard = await PathGuard.create(root);
  } catch {
    return found.map((ref) => ({ ref, valid: false }));
  }
  return Promise.all(
    found.map(async (ref) => {
      const artifact = parseArtifactRef(ref);
      if (artifact) return { ref, valid: issued.has(ref) && !!artifactExists?.(artifact.name) };
      const parsed = parseLineRef(ref);
      let valid = false;
      if (parsed && issued.has(ref))
        try {
          const window = await readWindow(guard, parsed.path, parsed.start, 1, new AbortController().signal);
          valid = parsed.end <= window.totalLines;
        } catch {
          /* removed/ignored/binary/outside source is unresolved */
        }
      return { ref, valid };
    }),
  );
}
