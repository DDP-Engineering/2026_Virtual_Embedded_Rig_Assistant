// REQ-UX-8a994f4b REQ-UX-58cf59b2 REQ-UX-fe9ec5c2 REQ-NFR-0fe89e49
import type { ViewerContent } from "@vera/shared";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FindBar } from "./find-bar.js";
import { decodeTextLines, detectTextEncoding, type TextEncoding, textEncodings } from "./text-encoding.js";
import { useTextRows } from "./use-text-rows.js";
import { ViewerToolbar } from "./viewer-toolbar.js";

const EMPTY_LINES: string[] = [];

function marked(text: string, query: string): ReactNode {
  if (!query) return text || " ";
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(query); at >= 0; at = lower.indexOf(query, at + query.length)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} data-search-match="true">
        {text.slice(at, at + query.length)}
      </mark>,
    );
    from = at + query.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts.length ? parts : " ";
}

/**
 * Continuous numbered text with measured wrapped rows and a bounded DOM. Find and Go to line
 * keep source-line identities while the layout changes.
 */
export function TextViewer({
  content,
  bytes,
  line: kept,
  onLine,
  findRequest,
  gotoRequest,
}: {
  content: Extract<ViewerContent, { kind: "text" }>;
  bytes?: Uint8Array | undefined;
  /** The first visible line the tab was left at. */
  line?: number | undefined;
  onLine?: ((line: number) => void) | undefined;
  /** Bumped by Ctrl+F and Ctrl+G in the document's tab. */
  findRequest: number;
  gotoRequest: number;
}) {
  const { t } = useTranslation();
  const [encoding, setEncoding] = useState<TextEncoding>(() => (bytes ? detectTextEncoding(bytes) : "utf-8"));
  const [replace, setReplace] = useState(false);
  const decoded = useMemo(
    () => (bytes ? decodeTextLines(bytes, encoding, replace) : content.lines),
    [bytes, encoding, replace, content.lines],
  );
  const lines = decoded ?? EMPTY_LINES;
  const [wrap, setWrap] = useState(false);
  const { body, probe, offsets, visible, scrollTo } = useTextRows(
    lines,
    wrap,
    {
      line: kept ?? content.start,
      align: kept ? "top" : "third",
    },
    onLine,
  );
  const [bar, setBar] = useState<"find" | "goto">();
  const [query, setQuery] = useState("");
  const [goto, setGoto] = useState("");
  const [current, setCurrent] = useState(0);
  const count = lines.length;
  const needle = query.trim().toLowerCase();
  // Lowered once per document, so each keystroke of a search only scans.
  const lower = useMemo(() => lines.map((text) => text.toLowerCase()), [lines]);
  const matches = useMemo(
    () => (needle ? lower.flatMap((text, i) => (text.includes(needle) ? [i + 1] : [])) : []),
    [lower, needle],
  );
  useEffect(() => {
    if (findRequest) setBar("find");
  }, [findRequest]);
  useEffect(() => {
    if (gotoRequest) setBar("goto");
  }, [gotoRequest]);
  const closeBar = () => {
    if (bar === "find") setQuery("");
    setBar(undefined);
    body.current?.focus();
  };
  return (
    <div className="text-viewer">
      <ViewerToolbar>
        <div className="document-toolbar">
          <label>
            <input
              type="checkbox"
              data-text-wrap
              checked={wrap}
              onChange={(event) => setWrap(event.target.checked)}
            />
            {t("documents.wordWrap")}
          </label>
          {bytes && (
            <label>
              {t("documents.encoding")}
              <select
                data-text-encoding
                value={encoding}
                onChange={(event) => {
                  setEncoding(event.target.value as TextEncoding);
                  setReplace(false);
                  setCurrent(0);
                }}
              >
                {textEncodings.map((value) => (
                  <option key={value} value={value}>
                    {value.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </ViewerToolbar>
      {decoded === null && (
        <div>
          <p role="alert">{t("documents.textBinary")}</p>
          <button type="button" data-show-as-text onClick={() => setReplace(true)}>
            {t("documents.showAsText")}
          </button>
        </div>
      )}
      {bar === "find" && (
        <FindBar
          label={t("documents.find")}
          value={query}
          status={
            needle
              ? t("documents.matchOf", { current: matches.length ? current + 1 : 0, total: matches.length })
              : undefined
          }
          change={(value) => {
            setQuery(value);
            setCurrent(0);
            const next = value.trim().toLowerCase();
            const hit = next ? lower.findIndex((text) => text.includes(next)) : -1;
            if (hit >= 0) scrollTo(hit + 1);
          }}
          step={(forward) => {
            if (!matches.length) return;
            const next = (current + (forward ? 1 : -1) + matches.length) % matches.length;
            setCurrent(next);
            scrollTo(matches[next] ?? 1);
          }}
          close={closeBar}
        />
      )}
      {bar === "goto" && (
        <FindBar
          numeric
          label={t("documents.goToLine")}
          value={goto}
          change={setGoto}
          step={() => {
            const line = Number(goto);
            if (Number.isInteger(line) && line > 0) scrollTo(line);
          }}
          close={closeBar}
        />
      )}
      <section
        ref={body}
        hidden={decoded === null}
        className="document-body"
        aria-label={t("documents.viewer")}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Named text region supports keyboard scrolling.
        tabIndex={0}
      >
        <div className="document-lines" data-wrap={wrap} style={{ height: offsets[count] ?? 0 }}>
          <div ref={probe} className="document-line-probe" aria-hidden="true">
            0
          </div>
          {visible.map((line) => {
            const text = lines[line - 1] ?? "";
            const matched = matches.length > 0 && matches[current] === line;
            return (
              <div
                key={line}
                data-line={line}
                data-current-match={matched || undefined}
                aria-current={
                  line >= content.start && line <= content.end && content.ref !== null ? "true" : undefined
                }
                style={{
                  top: offsets[line - 1],
                  minHeight:
                    offsets[line] === undefined ? undefined : (offsets[line] ?? 0) - (offsets[line - 1] ?? 0),
                }}
              >
                <span className="line-number">{line}</span>
                <span>{marked(text, needle)}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
