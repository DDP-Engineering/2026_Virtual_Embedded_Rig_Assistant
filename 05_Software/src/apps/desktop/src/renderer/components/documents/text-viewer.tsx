// REQ-UX-8a994f4b REQ-UX-58cf59b2 REQ-UX-fe9ec5c2 REQ-NFR-0fe89e49
import type { ViewerContent } from "@vera/shared";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FindBar } from "./find-bar.js";

/** Lines kept rendered beyond the view on each side; the DOM stays bounded for any file size. */
const OVERSCAN = 40;
/** The line height when layout reports none (a hidden tab or a test DOM). */
const FALLBACK_LINE = 20;

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
 * A text document as one continuous scroll of numbered lines (TASK-4c04273a). Lines do not wrap and
 * share one height, so the scroll height covers every line while only the lines near the view are
 * in the DOM. It opens at the kept first visible line, else at the cited lines; Ctrl+G and Ctrl+F
 * show a small field only when asked.
 */
export function TextViewer({
  content,
  line: kept,
  onLine,
  findRequest,
  gotoRequest,
}: {
  content: Extract<ViewerContent, { kind: "text" }>;
  /** The first visible line the tab was left at. */
  line?: number | undefined;
  onLine?: ((line: number) => void) | undefined;
  /** Bumped by Ctrl+F and Ctrl+G in the document's tab. */
  findRequest: number;
  gotoRequest: number;
}) {
  const { t } = useTranslation();
  const body = useRef<HTMLElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [lineHeight, setLineHeight] = useState(FALLBACK_LINE);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(0);
  const [bar, setBar] = useState<"find" | "goto">();
  const [query, setQuery] = useState("");
  const [goto, setGoto] = useState("");
  const [current, setCurrent] = useState(0);
  const count = content.lines.length;
  const needle = query.trim().toLowerCase();
  // Lowered once per document, so each keystroke of a search only scans.
  const lower = useMemo(() => content.lines.map((text) => text.toLowerCase()), [content.lines]);
  const matches = useMemo(
    () => (needle ? lower.flatMap((text, i) => (text.includes(needle) ? [i + 1] : [])) : []),
    [lower, needle],
  );
  const report = useRef(onLine);
  report.current = onLine;
  const scrollTo = (line: number, align: "top" | "third" = "third") => {
    const node = body.current;
    if (!node) return;
    const target = Math.max(1, Math.min(count, line));
    const offset = align === "top" ? 0 : Math.floor((node.clientHeight || 0) / 3);
    node.scrollTop = Math.max(0, (target - 1) * lineHeight - offset);
    setTop(node.scrollTop);
  };
  // One line's real height, measured once the body is laid out.
  useLayoutEffect(() => {
    const measured = probe.current?.getBoundingClientRect().height;
    if (measured && measured > 0) setLineHeight(measured);
  }, []);
  // The kept first line wins; otherwise the cited lines are brought into view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: placed once when the document mounts.
  useLayoutEffect(() => {
    if (kept) scrollTo(kept, "top");
    else if (content.start > 1) scrollTo(content.start);
  }, [lineHeight]);
  useEffect(() => {
    const node = body.current;
    if (!node) return;
    const sync = () => {
      setTop(node.scrollTop);
      setHeight(node.clientHeight);
      report.current?.(Math.floor(node.scrollTop / lineHeight) + 1);
    };
    sync();
    node.addEventListener("scroll", sync, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(sync);
    resize?.observe(node);
    return () => {
      node.removeEventListener("scroll", sync);
      resize?.disconnect();
    };
  }, [lineHeight]);
  useEffect(() => {
    if (findRequest) setBar("find");
  }, [findRequest]);
  useEffect(() => {
    if (gotoRequest) setBar("goto");
  }, [gotoRequest]);
  const first = Math.max(1, Math.floor(top / lineHeight) + 1 - OVERSCAN);
  const last = Math.min(count, Math.ceil((top + (height || lineHeight * 20)) / lineHeight) + OVERSCAN);
  const visible: number[] = [];
  for (let n = first; n <= last; n++) visible.push(n);
  const closeBar = () => {
    if (bar === "find") setQuery("");
    setBar(undefined);
    body.current?.focus();
  };
  return (
    <div className="text-viewer">
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
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Named text region supports keyboard scrolling. */}
      <section ref={body} className="document-body" aria-label={t("documents.viewer")} tabIndex={0}>
        <div className="document-lines" style={{ height: count * lineHeight }}>
          <div ref={probe} className="document-line-probe" aria-hidden="true">
            0
          </div>
          {visible.map((line) => {
            const text = content.lines[line - 1] ?? "";
            const matched = matches.length > 0 && matches[current] === line;
            return (
              <div
                key={line}
                data-line={line}
                data-current-match={matched || undefined}
                aria-current={
                  line >= content.start && line <= content.end && content.ref !== null ? "true" : undefined
                }
                style={{ top: (line - 1) * lineHeight, height: lineHeight }}
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
