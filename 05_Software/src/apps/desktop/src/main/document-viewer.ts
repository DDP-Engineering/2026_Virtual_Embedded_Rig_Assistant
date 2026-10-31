import {
  type DocumentRecord,
  documentSearchHitSchema,
  type Response,
  type ViewerContent,
  type WebDownload,
  webDownloadSchema,
} from "@vera/shared";

/** Preserve only structurally usable provenance after scrubbing every textual field. */
export function publicWebDownload(
  download: WebDownload,
  scrub: (text: string) => string,
): WebDownload | undefined {
  const result = webDownloadSchema.safeParse(
    Object.fromEntries(
      Object.entries(download).map(([name, value]) => [
        name,
        typeof value === "string" ? scrub(value) : value,
      ]),
    ),
  );
  return result.success ? result.data : undefined;
}

export function publicDocument(
  document: DocumentRecord,
  scrub: (text: string) => string,
): DocumentRecord | undefined {
  return scrub(document.path) === document.path ? document : undefined;
}
export function publicDocumentHit(
  hit: Response<"docs.search">["results"][number],
  scrub: (text: string) => string,
): Response<"docs.search">["results"][number] | undefined {
  // Redacted locator identities cannot resolve safely; keep other usable results.
  if (scrub(hit.ref) !== hit.ref || scrub(hit.path) !== hit.path) return undefined;
  const result = documentSearchHitSchema.safeParse({ ...hit, snippet: bounded(scrub(hit.snippet), 300) });
  return result.success ? result.data : undefined;
}
function bounded(text: string, limit: number): string {
  const value = text.slice(0, limit);
  return /[\uD800-\uDBFF]$/.test(value) ? value.slice(0, -1) : value;
}

/** Text crosses the same credential boundary as session/artifact content; PDF bytes stay exact. */
export function publicViewer(content: ViewerContent, scrub: (text: string) => string): ViewerContent {
  const base = {
    ...content,
    path: scrub(content.path),
    ref: content.ref === null ? null : scrub(content.ref),
    snippet: bounded(scrub(content.snippet), 12000),
  };
  switch (content.kind) {
    case "pdf":
      return {
        ...base,
        ...content,
        path: base.path,
        ref: base.ref,
        snippet: base.snippet,
        pages: content.pages.map(scrub),
      };
    case "text":
      return {
        ...base,
        kind: "text",
        lines: content.lines.map(scrub),
        start: content.start,
        end: content.end,
      };
    case "artifact":
      return {
        ...content,
        path: base.path,
        ref: scrub(content.ref),
        snippet: base.snippet,
        content: scrub(content.content),
      };
    case "markdown":
    case "html":
      return {
        ...base,
        kind: content.kind,
        anchor: content.anchor === null ? null : scrub(content.anchor),
        sections: content.sections.map((s) => ({
          ...s,
          slug: scrub(s.slug),
          text: scrub(s.text),
          path: s.path.map(scrub),
        })),
      };
  }
}
