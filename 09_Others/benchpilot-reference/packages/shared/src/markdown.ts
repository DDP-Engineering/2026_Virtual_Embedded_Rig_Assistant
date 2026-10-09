// Doc evidence anchors (01: `ev:TB-01/doc/docs/lab-notes.md#2026-09-29`): GitHub-style heading slugs.

/** "2026-09-29" → "2026-09-29", "SW-01 Gi1/0/7" → "sw-01-gi107". */
export function headingSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** The section under the heading whose slug is `anchor`, up to the next heading of the same or higher level. */
export function markdownSection(markdown: string, anchor: string): { heading: string; body: string } | null {
  const lines = markdown.split("\n");
  const at = lines.findIndex((l) => /^#{1,6}\s/.test(l) && headingSlug(l.replace(/^#+\s*/, "")) === anchor);
  if (at === -1) return null;
  const level = lines[at]!.match(/^#+/)![0].length;
  const end = lines.findIndex((l, i) => i > at && /^#{1,6}\s/.test(l) && l.match(/^#+/)![0].length <= level);
  return { heading: lines[at]!.replace(/^#+\s*/, ""), body: lines.slice(at + 1, end === -1 ? undefined : end).join("\n").trim() };
}
