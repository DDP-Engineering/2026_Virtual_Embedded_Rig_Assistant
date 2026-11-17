import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TextWindow } from "./large-text-window.js";
import { useTextRows } from "./use-text-rows.js";

export interface LocatedTextWindow extends TextWindow {
  line: number;
  exact: boolean;
}

/** Measured, virtual source rows for one byte window; row numbers can settle independently. */
export function LargeTextRows({
  view,
  wrap,
  query,
  moved,
  navigate,
  size,
  citation,
}: {
  view: LocatedTextWindow;
  wrap: boolean;
  query: string;
  size: number;
  citation?: { start: number; end: number } | undefined;
  moved: (offset: number) => void;
  navigate: (offset: number) => void;
}) {
  const { t } = useTranslation();
  const { body, probe, offsets, visible } = useTextRows(
    view.lines,
    wrap,
    { line: view.target, align: "third" },
    (line) => moved(view.starts[line - 1] ?? view.offset),
    view.line,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: A settled window or wrap change restores its exact Find column after row measurement.
  useEffect(() => {
    const node = body.current;
    const mark = node?.querySelector<HTMLElement>("[data-current-search-match]");
    if (!node || !mark) return;
    const container = node.getBoundingClientRect(),
      found = mark.getBoundingClientRect();
    node.scrollLeft += found.left - container.left - node.clientWidth / 3;
    node.scrollTop += found.top - container.top - node.clientHeight / 3;
  }, [view, wrap, query, offsets]);
  return (
    <section
      ref={body}
      className="document-body"
      aria-label={t("documents.viewer")}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Named text region supports keyboard scrolling.
      tabIndex={0}
      onWheel={(event) => {
        const node = event.currentTarget;
        if (
          event.deltaY > 0 &&
          node.scrollTop + node.clientHeight >= node.scrollHeight - 2 &&
          view.end < size
        ) {
          event.preventDefault();
          navigate(Math.max(0, view.end - 4));
        } else if (event.deltaY < 0 && node.scrollTop <= 0 && view.offset > 0) {
          event.preventDefault();
          navigate(Math.max(0, view.offset - 48000));
        }
      }}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && (event.key === "Home" || event.key === "End")) {
          event.preventDefault();
          navigate(event.key === "Home" ? 0 : size);
        } else if (
          (event.key === "PageDown" || event.key === "ArrowDown") &&
          view.end < size &&
          event.currentTarget.scrollTop + event.currentTarget.clientHeight >=
            event.currentTarget.scrollHeight - 2
        ) {
          event.preventDefault();
          navigate(Math.max(0, view.end - 4));
        } else if (
          (event.key === "PageUp" || event.key === "ArrowUp") &&
          view.offset > 0 &&
          event.currentTarget.scrollTop <= 0
        ) {
          event.preventDefault();
          navigate(Math.max(0, view.offset - 48000));
        }
      }}
    >
      <div className="document-lines" data-wrap={wrap} style={{ height: offsets[view.lines.length] ?? 0 }}>
        <div ref={probe} className="document-line-probe" aria-hidden="true">
          0
        </div>
        {visible.map((local) => {
          const text = view.lines[local - 1] ?? "";
          const expression = query
            ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
            : undefined;
          let match = expression?.exec(text);
          if (local === view.target)
            while (match && match.index < view.column) match = expression?.exec(text);
          return (
            <div
              key={local}
              data-line={view.line + local - 1}
              aria-current={
                citation && view.line + local - 1 >= citation.start && view.line + local - 1 <= citation.end
                  ? "true"
                  : undefined
              }
              data-current-match={!!match || undefined}
              style={{
                top: offsets[local - 1],
                minHeight: (offsets[local] ?? 0) - (offsets[local - 1] ?? 0),
              }}
            >
              <span className="line-number">
                {view.exact ? "" : "≈"}
                {view.line + local - 1}
              </span>
              <span>
                {local === 1 && view.offset > 0 ? "…" : ""}
                {match ? (
                  <>
                    {text.slice(0, match.index)}
                    <mark
                      data-search-match
                      data-current-search-match={
                        (local === view.target && match.index === view.column) || undefined
                      }
                    >
                      {match[0]}
                    </mark>
                    {text.slice(match.index + match[0].length)}
                  </>
                ) : (
                  text || " "
                )}
                {local === view.lines.length && view.end < size ? "…" : ""}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
