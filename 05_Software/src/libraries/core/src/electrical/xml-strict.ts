// A strict, span-keeping XML reader for QElectroTech projects (spec REQ-DATA-963cbdf6 "Strict XML"). It accepts the
// subset QET writes - one leading declaration, elements, attributes, text, comments, CDATA, the five predefined
// entities and character references - and refuses every document type declaration, so no entity is ever expanded
// and no external resource is ever named. Each element keeps the source offsets edits need to splice the text.

export interface XmlAttribute {
  name: string;
  value: string;
  /** Offsets of the raw value between the quotes, in the source string. */
  valueStart: number;
  valueEnd: number;
}
export interface XmlElement {
  name: string;
  attributes: XmlAttribute[];
  children: XmlElement[];
  /** Decoded character data directly inside the element (children excluded). */
  text: string;
  start: number;
  /** Offset just after the start tag's `>`. */
  contentStart: number;
  /** Offset of the end tag's `<` (equal to contentStart for a self-closing element). */
  contentEnd: number;
  end: number;
  selfClosing: boolean;
  line: number;
}

export const xmlLimits = { chars: 16 * 1024 * 1024, depth: 64, nodes: 500_000 } as const;

const NAME = /[A-Za-z_:][-A-Za-z0-9._:·À-�]*/y;
const SPACE = /[ \t\r\n]+/y;
const PREDEFINED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
// C0 controls other than tab, LF and CR, and the two non-characters, are never XML characters.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the reader refuses exactly these characters.
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

/** Decodes UTF-8 bytes strictly; a UTF-16 or UTF-32 byte-order mark or invalid UTF-8 is refused. */
export function decodeXmlBytes(bytes: Uint8Array, label: string): string {
  const fail = (reason: string) => Error(`Invalid QElectroTech project ${label}: line 1: ${reason}.`);
  if (bytes.length > xmlLimits.chars)
    throw fail(`the file is larger than ${xmlLimits.chars / 1024 / 1024} MiB`);
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
    throw fail("only UTF-8 is read, the file is UTF-16");
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw fail("the file is not valid UTF-8");
  }
}

/** Parses the document; throws `Invalid QElectroTech project <label>: line <n>: <reason>.` on anything outside the subset. */
export function parseStrictXml(source: string, label: string): XmlElement {
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  let nodes = 0;
  // Element starts only move forward, so their line numbers come from one running count (linear, not per element).
  let counted = 0;
  let lines = 1;
  const lineOf = (at: number) => {
    for (; counted < at; counted++) if (source.charCodeAt(counted) === 10) lines++;
    return lines;
  };
  const fail = (reason: string, at = i): never => {
    throw Error(`Invalid QElectroTech project ${label}: line ${lineAt(source, at)}: ${reason}.`);
  };
  if (source.length > xmlLimits.chars)
    fail(`the file is larger than ${xmlLimits.chars / 1024 / 1024} MiB`, 0);
  const bad = NOT_XML.exec(source);
  if (bad)
    fail(`character U+${bad[0].charCodeAt(0).toString(16).padStart(4, "0")} is not allowed`, bad.index);

  const name = (): string => {
    NAME.lastIndex = i;
    const match = NAME.exec(source);
    if (!match) fail("a name is expected");
    i = NAME.lastIndex;
    return (match as RegExpExecArray)[0];
  };
  const space = (): boolean => {
    SPACE.lastIndex = i;
    if (!SPACE.exec(source)) return false;
    i = SPACE.lastIndex;
    return true;
  };
  const decode = (raw: string, at: number, attribute: boolean): string =>
    raw.replace(/&([^;&<\s]*);?|[\t\n\r]/g, (match, entity: string | undefined, offset: number) => {
      if (entity === undefined) return attribute ? " " : match;
      if (!match.endsWith(";")) fail("an unterminated entity reference", at + offset);
      if (Object.hasOwn(PREDEFINED, entity)) return PREDEFINED[entity] as string;
      const numeric = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/.exec(entity);
      if (!numeric)
        fail(`the entity &${entity}; is not allowed (only &lt; &gt; &amp; &quot; &apos;)`, at + offset);
      const code = Number.parseInt(
        (numeric as RegExpExecArray)[1] ?? (numeric as RegExpExecArray)[2] ?? "",
        numeric?.[1] ? 16 : 10,
      );
      const valid =
        code === 9 ||
        code === 10 ||
        code === 13 ||
        (code >= 0x20 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd) ||
        (code >= 0x10000 && code <= 0x10ffff);
      if (!valid) fail(`the character reference &${entity}; is not an XML character`, at + offset);
      return String.fromCodePoint(code);
    });
  /** Skips comments, and the leading declaration when `prolog` is set; refuses DTDs and other instructions. */
  const misc = (prolog: boolean): boolean => {
    if (source.startsWith("<!--", i)) {
      const close = source.indexOf("-->", i + 4);
      if (close < 0) fail("an unclosed comment");
      if (source.slice(i + 4, close).includes("--")) fail("'--' inside a comment");
      i = close + 3;
      return true;
    }
    if (source.startsWith("<?", i)) {
      const close = source.indexOf("?>", i + 2);
      if (close < 0) fail("an unclosed processing instruction");
      const body = source.slice(i + 2, close);
      if (!prolog || !/^xml[ \t\r\n]/.test(body) || i > (source.charCodeAt(0) === 0xfeff ? 1 : 0))
        fail("processing instructions are not allowed (only the leading XML declaration)");
      const encoding = /encoding[ \t\r\n]*=[ \t\r\n]*["']([^"']*)["']/.exec(body)?.[1];
      if (encoding !== undefined && !/^utf-?8$/i.test(encoding))
        fail(`the encoding ${encoding} is not read (only UTF-8)`);
      i = close + 2;
      return true;
    }
    if (source.startsWith("<!DOCTYPE", i) || source.startsWith("<!doctype", i))
      fail("document type declarations are not allowed (no DTD, no entities)");
    if (source.startsWith("<!", i) && !source.startsWith("<![CDATA[", i))
      fail("declarations are not allowed");
    return false;
  };

  const element = (depth: number): XmlElement => {
    if (depth > xmlLimits.depth) fail(`more than ${xmlLimits.depth} nested elements`);
    if (++nodes > xmlLimits.nodes) fail(`more than ${xmlLimits.nodes} elements`);
    const start = i;
    i++; // '<'
    const tag = name();
    const attributes: XmlAttribute[] = [];
    for (;;) {
      const spaced = space();
      if (source.startsWith("/>", i) || source[i] === ">") break;
      if (!spaced) fail(`a space or the end of the tag <${tag}> is expected`);
      const attrName = name();
      space();
      if (source[i] !== "=") fail(`'=' is expected after the attribute ${attrName}`);
      i++;
      space();
      const quote = source[i];
      if (quote !== '"' && quote !== "'") fail(`the value of ${attrName} must be quoted`);
      const valueStart = i + 1;
      const valueEnd = source.indexOf(quote as string, valueStart);
      if (valueEnd < 0) fail(`the value of ${attrName} is not closed`);
      const raw = source.slice(valueStart, valueEnd);
      if (raw.includes("<")) fail(`'<' in the value of ${attrName}`, valueStart);
      if (attributes.some((entry) => entry.name === attrName)) fail(`the attribute ${attrName} is repeated`);
      attributes.push({ name: attrName, value: decode(raw, valueStart, true), valueStart, valueEnd });
      i = valueEnd + 1;
    }
    const line = lineOf(start);
    if (source.startsWith("/>", i)) {
      i += 2;
      return {
        name: tag,
        attributes,
        children: [],
        text: "",
        start,
        contentStart: i,
        contentEnd: i,
        end: i,
        selfClosing: true,
        line,
      };
    }
    i++; // '>'
    const contentStart = i;
    const children: XmlElement[] = [];
    let text = "";
    for (;;) {
      if (i >= source.length) fail(`<${tag}> is not closed`, start);
      if (source.startsWith("</", i)) {
        const contentEnd = i;
        i += 2;
        const closing = name();
        if (closing !== tag) fail(`</${closing}> closes <${tag}>`);
        space();
        if (source[i] !== ">") fail(`'>' is expected after </${closing}`);
        i++;
        return {
          name: tag,
          attributes,
          children,
          text,
          start,
          contentStart,
          contentEnd,
          end: i,
          selfClosing: false,
          line,
        };
      }
      if (source.startsWith("<![CDATA[", i)) {
        const close = source.indexOf("]]>", i + 9);
        if (close < 0) fail("an unclosed CDATA section");
        text += source.slice(i + 9, close);
        i = close + 3;
        continue;
      }
      if (source[i] === "<") {
        if (misc(false)) continue;
        children.push(element(depth + 1));
        continue;
      }
      const next = source.indexOf("<", i);
      const end = next < 0 ? source.length : next;
      text += decode(source.slice(i, end), i, false);
      i = end;
    }
  };

  for (;;) {
    space();
    if (!misc(true)) break;
  }
  if (source[i] !== "<") fail("the document must start with an element");
  const root = element(1);
  for (;;) {
    space();
    if (i >= source.length) break;
    if (!misc(false)) fail(source[i] === "<" ? "a second root element" : "text after the root element");
  }
  return root;
}

export const attr = (element: XmlElement, name: string): string | undefined =>
  element.attributes.find((entry) => entry.name === name)?.value;
export const childrenNamed = (element: XmlElement, name: string): XmlElement[] =>
  element.children.filter((entry) => entry.name === name);
export const childNamed = (element: XmlElement, name: string): XmlElement | undefined =>
  element.children.find((entry) => entry.name === name);
/** Escapes text for element content. */
export const escapeText = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Escapes text for a double-quoted attribute value. */
export const escapeAttribute = (value: string): string =>
  escapeText(value)
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;")
    .replace(/\t/g, "&#9;");
