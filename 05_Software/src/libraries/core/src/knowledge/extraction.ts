import { fromMarkdown } from "mdast-util-from-markdown";
import { type DefaultTreeAdapterMap, parse } from "parse5";
import { z } from "zod";
import { textLines } from "../tools/files.js";

const sectionSchema = z
  .object({
    path: z.array(z.string()),
    slug: z.string(),
    text: z.string(),
    start: z.number().int().positive(),
    end: z.number().int().positive(),
  })
  .strict();
export const extractionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pdf"), pages: z.array(z.string()).min(1) }).strict(),
  z.object({ kind: z.literal("text"), lines: z.array(z.string()) }).strict(),
  z.object({ kind: z.enum(["markdown", "html"]), sections: z.array(sectionSchema) }).strict(),
]);
export type Extraction = z.infer<typeof extractionSchema>;
type Section = z.infer<typeof sectionSchema>;

function slugger() {
  const used = new Set<string>();
  return (title: string) => {
    const base =
      title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_\s-]/gu, "")
        .trim()
        .replace(/\s+/g, "-") || "section";
    let slug = base;
    for (let n = 1; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return slug;
  };
}
/** ATX/Setext headings come from CommonMark, so fenced code cannot invent anchors. */
export function extractMarkdown(text: string): Extraction {
  const lines = textLines(text);
  const sections: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  const slug = slugger();
  let start = 1,
    path: string[] = [],
    anchor = "";
  const finish = (end: number) => {
    if (end >= start)
      sections.push({
        path: [...path],
        slug: anchor,
        start,
        end,
        text: lines.slice(start - 1, end).join("\n"),
      });
  };
  const titleText = (node: { type: string; value?: string; children?: unknown[] }): string => {
    if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
    return (node.children ?? []).map((child) => titleText(child as Parameters<typeof titleText>[0])).join("");
  };
  for (const node of fromMarkdown(text).children) {
    if (node.type !== "heading" || !node.position) continue;
    finish(node.position.start.line - 1);
    const title = titleText(node);
    while (stack.length && (stack.at(-1)?.level ?? 0) >= node.depth) stack.pop();
    stack.push({ level: node.depth, title });
    path = stack.map((item) => item.title);
    anchor = slug(title);
    start = node.position.start.line;
  }
  finish(lines.length);
  return { kind: "markdown", sections };
}

/** Parse locally without fetching resources, keeping entity-decoded visible block text. */
export function extractHtml(text: string): Extraction {
  const sections: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  const slug = slugger();
  let path: string[] = [],
    anchor = "",
    content = "";
  const finish = () => {
    const visible = content
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (visible)
      sections.push({
        path: [...path],
        slug: anchor,
        text: visible,
        start: 1,
        end: textLines(visible).length,
      });
    content = "";
  };
  type Node = DefaultTreeAdapterMap["node"];
  const skipped = new Set(["script", "style", "template", "head"]);
  const blocks = new Set([
    "p",
    "div",
    "section",
    "article",
    "main",
    "li",
    "ul",
    "ol",
    "table",
    "tr",
    "pre",
    "blockquote",
  ]);
  const visibleText = (node: Node): string => {
    if ("tagName" in node && skipped.has(node.tagName)) return "";
    if ("value" in node) return node.value;
    return "childNodes" in node ? node.childNodes.map(visibleText).join("") : "";
  };
  const walk = (node: Node): void => {
    if ("tagName" in node) {
      const tag = node.tagName;
      if (skipped.has(tag)) return;
      if (/^h[1-6]$/.test(tag)) {
        finish();
        const level = Number(tag[1]),
          title = visibleText(node).replace(/\s+/g, " ").trim();
        while (stack.length && (stack.at(-1)?.level ?? 0) >= level) stack.pop();
        stack.push({ level, title });
        path = stack.map((item) => item.title);
        anchor = slug(title);
        content = `${title}\n\n`;
        return;
      }
      if (tag === "br") {
        content += "\n";
        return;
      }
      if (blocks.has(tag)) content += "\n\n";
      if (tag === "td" || tag === "th") content += " ";
      for (const child of node.childNodes) walk(child);
      if (blocks.has(tag)) content += "\n\n";
    } else if ("value" in node) content += node.value;
    else if ("childNodes" in node) for (const child of node.childNodes) walk(child);
  };
  walk(parse(text));
  finish();
  return { kind: "html", sections };
}
export function extractText(text: string): Extraction {
  return { kind: "text", lines: textLines(text) };
}
