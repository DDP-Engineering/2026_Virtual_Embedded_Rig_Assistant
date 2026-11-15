// REQ-FUNC-7cd31fe3
export interface LineRef {
  path: string;
  start: number;
  end: number;
}
function valid(value: LineRef): boolean {
  return (
    !!value.path &&
    !/[\0\r\n\u2028\u2029\\:]/.test(value.path) &&
    !value.path.startsWith("/") &&
    !value.path.split("/").some((segment) => segment === ".." || segment === "." || !segment) &&
    Number.isSafeInteger(value.start) &&
    Number.isSafeInteger(value.end) &&
    value.start >= 1 &&
    value.end >= value.start
  );
}
export function formatLineRef(value: LineRef): string {
  if (!valid(value)) throw Error("Invalid line reference.");
  return `${value.path}#L${value.start}-L${value.end}`;
}
export function parseLineRef(text: string): LineRef | undefined {
  const match = /^(.*)#L([1-9]\d*)-L([1-9]\d*)$/.exec(text);
  if (!match || match[0] !== text) return undefined;
  const value = { path: match[1] ?? "", start: Number(match[2]), end: Number(match[3]) };
  return valid(value) ? value : undefined;
}

/** Portable ordinary file name for the application-managed artifact namespace. */
export function validArtifactName(name: string): boolean {
  return (
    /^[A-Za-z0-9._-]{1,100}$/.exec(name)?.[0] === name &&
    name !== "." &&
    name !== ".." &&
    !name.endsWith(".") &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  );
}
export function formatArtifactRef(name: string): string {
  if (!validArtifactName(name)) throw Error("Invalid artifact name.");
  return `artifact:${name}`;
}
export function parseArtifactRef(text: string): { name: string } | undefined {
  const name = text.startsWith("artifact:") ? text.slice(9) : "";
  return validArtifactName(name) ? { name } : undefined;
}

export type Reference =
  | { kind: "page"; path: string; page: number }
  | { kind: "page-range"; path: string; start: number; end: number }
  | { kind: "heading"; path: string; slug: string }
  | ({ kind: "lines" } & LineRef)
  | { kind: "artifact"; name: string }
  | { kind: "help"; page: string }
  | { kind: "help"; plugin: string };
const helpName = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** `help:<page>` names an app help page, `help:plugin/<id>` a plugin's help page (the help tool issues them). */
function parseHelpRef(text: string): Reference | undefined {
  if (!text.startsWith("help:")) return undefined;
  const target = text.slice(5);
  if (target.startsWith("plugin/")) {
    const plugin = target.slice(7);
    return helpName.test(plugin) ? { kind: "help", plugin } : undefined;
  }
  return helpName.test(target) ? { kind: "help", page: target } : undefined;
}

/** Pure syntax only; source/provenance/session bounds belong to core. */
export function parseRef(text: string): Reference | undefined {
  if (/[\r\n\u2028\u2029]/.test(text)) return undefined;
  if (text.startsWith("help:")) return parseHelpRef(text);
  const artifact = parseArtifactRef(text);
  if (artifact) return { kind: "artifact", ...artifact };
  const lines = parseLineRef(text);
  if (lines) return { kind: "lines", ...lines };
  const page = /^(.*)#p=([1-9]\d*)(?:-([1-9]\d*))?$/.exec(text);
  if (page) {
    const value = { path: page[1] ?? "", start: Number(page[2]), end: Number(page[3] ?? page[2]) };
    if (!valid(value)) return undefined;
    return page[3] ? { kind: "page-range", ...value } : { kind: "page", path: value.path, page: value.start };
  }
  // An empty slug names the untitled text before a document's first heading.
  const heading = /^(.*)#h=([\p{L}\p{N}_-]*)$/u.exec(text);
  if (heading && valid({ path: heading[1] ?? "", start: 1, end: 1 }))
    return { kind: "heading", path: heading[1] ?? "", slug: heading[2] ?? "" };
  return undefined;
}

export function formatRef(value: Reference): string {
  let ref: string;
  switch (value.kind) {
    case "artifact":
      return formatArtifactRef(value.name);
    case "help":
      ref = "plugin" in value ? `help:plugin/${value.plugin}` : `help:${value.page}`;
      break;
    case "lines":
      return formatLineRef(value);
    case "page":
      if (!valid({ path: value.path, start: value.page, end: value.page })) throw Error("Invalid reference.");
      ref = `${value.path}#p=${value.page}`;
      break;
    case "page-range":
      if (!valid(value)) throw Error("Invalid reference.");
      ref = `${value.path}#p=${value.start}-${value.end}`;
      break;
    case "heading":
      if (
        !valid({ path: value.path, start: 1, end: 1 }) ||
        /^[\p{L}\p{N}_-]*$/u.exec(value.slug)?.[0] !== value.slug
      )
        throw Error("Invalid reference.");
      ref = `${value.path}#h=${value.slug}`;
      break;
  }
  if (!parseRef(ref)) throw Error("Invalid reference.");
  return ref;
}

/** Compact chip label; retain the full reference in tooltip/accessibility. */
export function referenceLabel(ref: string): string {
  const value = parseRef(ref);
  if (!value) return ref;
  if (value.kind === "artifact") return value.name;
  if (value.kind === "help") return "plugin" in value ? value.plugin : value.page;
  const file = value.path.split("/").at(-1) ?? value.path;
  switch (value.kind) {
    case "page":
      return `${file} p${value.page}`;
    case "page-range":
      return `${file} p${value.start}–${value.end}`;
    case "heading":
      return `${file} #${value.slug || "start"}`;
    case "lines":
      return `${file} L${value.start}${value.end === value.start ? "" : `–${value.end}`}`;
  }
}
