// REQ-UX-28ad0002 REQ-UX-e4d5ce0f REQ-UX-e8dfdec3 REQ-UX-3eb27a6c REQ-NFR-0fe89e49
import type { ViewerContent } from "@vera/shared";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type RenderTask,
  TextLayer,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FindBar } from "./find-bar.js";

GlobalWorkerOptions.workerSrc = workerUrl;
const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
/** Match across pdf.js text runs; retain original spans/geometry and highlight only matching ranges. */
export function highlightText(layer: HTMLElement, snippet: string, search: string) {
  const spans = [...layer.querySelectorAll<HTMLSpanElement>("span")].filter(
    (s) => !s.classList.contains("markedContent"),
  );
  const original = spans.map((s) => s.dataset.original ?? s.textContent ?? "");
  const map: { span: number; offset: number }[] = [],
    chars: string[] = [];
  original.forEach((value, span) => {
    if (chars.length && chars.at(-1) !== " ") {
      chars.push(" ");
      map.push({ span, offset: 0 });
    }
    for (let offset = 0; offset < value.length; offset++) {
      const char = value.charAt(offset);
      if (/\s/.test(char)) {
        if (chars.at(-1) === " ") continue;
        chars.push(" ");
      } else chars.push(char.toLowerCase());
      map.push({ span, offset });
    }
  });
  const text = chars.join("");
  const cited = new Set<string>(),
    found = new Set<string>();
  for (const [query, set] of [
    [normalize(snippet), cited],
    [normalize(search), found],
  ] as const) {
    if (!query) continue;
    for (let at = text.indexOf(query); at >= 0; at = text.indexOf(query, at + Math.max(1, query.length)))
      for (let i = at; i < at + query.length; i++) {
        const pos = map[i];
        if (pos) set.add(`${pos.span}/${pos.offset}`);
      }
  }
  spans.forEach((span, n) => {
    const value = original[n] ?? "";
    span.dataset.original = value;
    span.replaceChildren();
    for (let start = 0; start < value.length; ) {
      const citation = cited.has(`${n}/${start}`),
        match = found.has(`${n}/${start}`);
      let end = start + 1;
      while (
        end < value.length &&
        cited.has(`${n}/${end}`) === citation &&
        found.has(`${n}/${end}`) === match
      )
        end++;
      if (citation || match) {
        const mark = document.createElement("mark");
        if (citation) mark.dataset.cited = "true";
        if (match) mark.dataset.searchMatch = "true";
        mark.textContent = value.slice(start, end);
        span.append(mark);
      } else span.append(document.createTextNode(value.slice(start, end)));
      start = end;
    }
  });
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
/** The page gap in CSS pixels; pages and gaps make up the scroll height. */
const GAP = 12;
/** Pages rendered around the one in view; the rest are empty boxes of the right size. */
const AROUND = 2;
type Size = { width: number; height: number };

/** One page: its canvas and text layer, drawn at the zoom, with the snippet and matches marked. */
function PdfPage({
  pdf,
  number,
  zoom,
  snippet,
  query,
  rendered,
}: {
  pdf: PDFDocumentProxy;
  number: number;
  zoom: number;
  snippet: string;
  query: string;
  rendered: (number: number, drawn: boolean) => void;
}) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const done = useRef(rendered);
  done.current = rendered;
  useEffect(() => {
    let alive = true,
      render: RenderTask | undefined,
      layer: TextLayer | undefined;
    setReady(false);
    void (async () => {
      const page = await pdf.getPage(number);
      if (!alive || !canvas.current || !text.current) return;
      const viewport = page.getViewport({ scale: zoom });
      if (viewport.width <= 0 || viewport.height <= 0 || viewport.width * viewport.height > 16000000)
        throw Error("Page exceeds canvas budget");
      canvas.current.width = Math.ceil(viewport.width);
      canvas.current.height = Math.ceil(viewport.height);
      text.current.replaceChildren();
      text.current.style.setProperty("--total-scale-factor", String(zoom));
      const context = canvas.current.getContext("2d");
      if (!context) throw Error("Canvas unavailable");
      render = page.render({ canvas: canvas.current, canvasContext: context, viewport });
      layer = new TextLayer({
        container: text.current,
        viewport,
        textContentSource: await page.getTextContent(),
      });
      await Promise.all([render.promise, layer.render()]);
      if (alive) {
        setReady(true);
        done.current(number, true);
      }
    })().catch(() => {
      /* An unrenderable page stays an empty box; its text is still searchable. */
    });
    return () => {
      alive = false;
      render?.cancel();
      layer?.cancel();
      done.current(number, false);
    };
  }, [pdf, number, zoom]);
  useEffect(() => {
    if (ready && text.current) highlightText(text.current, snippet, query);
  }, [ready, snippet, query]);
  return (
    <>
      <canvas ref={canvas} aria-label={t("documents.pageNumber", { page: number })} />
      <div ref={text} className="pdf-text-layer" aria-hidden="true" />
    </>
  );
}

/**
 * A PDF as one continuous scroll of pages (TASK-4c04273a): every page has its box from the start,
 * only the page in view and its neighbours are drawn, and a small indicator shows the page in view.
 * Ctrl+wheel, Ctrl+= / Ctrl+- and Ctrl+0 zoom; Ctrl+F (a request from the tab) shows a find field.
 */
export default function PdfViewer({
  content,
  page: kept,
  onPage,
  findRequest = 0,
}: {
  content: Extract<ViewerContent, { kind: "pdf" }>;
  /** The page the tab was left at; without it the cited page opens (TASK-79f6ffd3). */
  page?: number | undefined;
  onPage?: ((page: number) => void) | undefined;
  findRequest?: number | undefined;
}) {
  const { t } = useTranslation();
  const [pdf, setPdf] = useState<PDFDocumentProxy>(),
    [sizes, setSizes] = useState<Size[]>(),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0),
    [zoom, setZoom] = useState(1),
    [current, setCurrent] = useState(kept && kept <= content.pages.length ? kept : content.page),
    [drawn, setDrawn] = useState<ReadonlySet<number>>(new Set()),
    [finding, setFinding] = useState(false),
    [query, setQuery] = useState(""),
    [match, setMatch] = useState(0);
  const scroll = useRef<HTMLElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const report = useRef(onPage);
  report.current = onPage;
  const count = content.pages.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt retries parsing after a PDF error.
  useEffect(() => {
    setError(false);
    setPdf(undefined);
    setSizes(undefined);
    const data = Uint8Array.from(atob(content.data), (char) => char.charCodeAt(0));
    const base = new URL("./pdfjs/", document.baseURI).href;
    const loading = getDocument({
      data,
      cMapUrl: `${base}cmaps/`,
      standardFontDataUrl: `${base}standard_fonts/`,
      wasmUrl: `${base}wasm/`,
      useWorkerFetch: true,
      useSystemFonts: false,
      useWasm: false,
      stopAtErrors: true,
    });
    let alive = true;
    void loading.promise
      .then(async (doc) => {
        if (doc.numPages !== count) throw Error("Page count mismatch");
        // Every page's box is known up front, so the scroll covers the whole document.
        const all = await Promise.all(
          Array.from({ length: count }, async (_, i) => {
            const viewport = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
            return { width: viewport.width, height: viewport.height };
          }),
        );
        if (!alive) return;
        setPdf(doc);
        setSizes(all);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
      void loading.destroy();
    };
  }, [content, attempt]);
  const tops = useMemo(() => {
    const list: number[] = [];
    let y = 0;
    for (const size of sizes ?? []) {
      list.push(y);
      y += size.height * zoom + GAP;
    }
    return list;
  }, [sizes, zoom]);
  const pageAt = (y: number) => {
    let found = 1;
    for (let i = 0; i < tops.length; i++) if ((tops[i] ?? 0) <= y) found = i + 1;
    return found;
  };
  /** The offset a programmatic scroll landed on; the scroll event it causes keeps its page. */
  const pinned = useRef<number | undefined>(undefined);
  const show = (page: number) => {
    const node = scroll.current;
    const target = Math.max(1, Math.min(count, page));
    if (node) {
      node.scrollTop = tops[target - 1] ?? 0;
      pinned.current = node.scrollTop;
    }
    setCurrent(target);
  };
  // Open at the kept or cited page once the boxes exist; keep the same page through a zoom change.
  const placed = useRef(false);
  const currentRef = useRef(current);
  currentRef.current = current;
  // biome-ignore lint/correctness/useExhaustiveDependencies: placing follows the boxes and the zoom only.
  useLayoutEffect(() => {
    if (!tops.length) return;
    show(currentRef.current);
    placed.current = true;
  }, [tops]);
  useEffect(() => {
    report.current?.(current);
  }, [current]);
  const step = (direction: -1 | 0 | 1) =>
    setZoom((value) => {
      if (direction === 0) return 1;
      const index = ZOOMS.indexOf(value as (typeof ZOOMS)[number]);
      return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, index + direction))] ?? value;
    });
  const pageAtRef = useRef(pageAt);
  pageAtRef.current = pageAt;
  const stepRef = useRef(step);
  stepRef.current = step;
  // The scroll element is new after a failed load is retried, so the listeners follow `error`.
  useEffect(() => {
    void error;
    const node = scroll.current;
    if (!node) return;
    const sync = () => {
      if (!placed.current) return;
      if (pinned.current !== undefined && Math.abs(node.scrollTop - pinned.current) < 2) return;
      pinned.current = undefined;
      setCurrent(pageAtRef.current(node.scrollTop + node.clientHeight / 3));
    };
    node.addEventListener("scroll", sync, { passive: true });
    // Ctrl+wheel zooms the document, not the window; a plain wheel scrolls. A trackpad pinch sends
    // many small deltas, so a step needs a whole wheel notch (100) in one direction.
    let delta = 0;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      delta += event.deltaY;
      if (Math.abs(delta) < 100) return;
      stepRef.current(delta < 0 ? 1 : -1);
      delta = 0;
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => {
      node.removeEventListener("scroll", sync);
      node.removeEventListener("wheel", wheel);
    };
  }, [error]);
  // Zoom keys work anywhere in the document's panel, which takes focus when the tab opens.
  useEffect(() => {
    void error;
    const target = root.current?.closest<HTMLElement>("[data-source-current]") ?? root.current;
    if (!target) return;
    const keys = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const direction =
        event.key === "=" || event.key === "+"
          ? 1
          : event.key === "-"
            ? -1
            : event.key === "0"
              ? 0
              : undefined;
      if (direction === undefined) return;
      event.preventDefault();
      stepRef.current(direction);
    };
    target.addEventListener("keydown", keys);
    return () => target.removeEventListener("keydown", keys);
  }, [error]);
  useEffect(() => {
    if (findRequest) setFinding(true);
  }, [findRequest]);
  const needle = normalize(query);
  const matches = useMemo(() => {
    if (!needle) return [];
    const list: number[] = [];
    content.pages.forEach((text, i) => {
      const value = normalize(text);
      for (let at = value.indexOf(needle); at >= 0; at = value.indexOf(needle, at + needle.length))
        list.push(i + 1);
    });
    return list;
  }, [content.pages, needle]);
  const ready = drawn.has(current);
  const snippetFor = (page: number) => {
    if (page < content.page || page > content.pageEnd) return "";
    const text = content.pages[page - 1] ?? "";
    return text && normalize(content.snippet).includes(normalize(text)) ? text : content.snippet;
  };
  if (error)
    return (
      <>
        <p role="alert">{t("documents.pdfError")}</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          {t("settings.retry")}
        </button>
      </>
    );
  return (
    <div ref={root} className="pdf-viewer" data-page={current} data-ready={ready} data-zoom={zoom}>
      {finding && (
        <FindBar
          label={t("documents.find")}
          value={query}
          status={
            needle
              ? t("documents.matchOf", { current: matches.length ? match + 1 : 0, total: matches.length })
              : undefined
          }
          change={(value) => {
            setQuery(value);
            setMatch(0);
            const next = normalize(value);
            const hit = next ? content.pages.findIndex((text) => normalize(text).includes(next)) : -1;
            if (hit >= 0) show(hit + 1);
          }}
          step={(forward) => {
            if (!matches.length) return;
            const next = (match + (forward ? 1 : -1) + matches.length) % matches.length;
            setMatch(next);
            show(matches[next] ?? 1);
          }}
          close={() => {
            setFinding(false);
            scroll.current?.focus();
          }}
        />
      )}
      {!sizes && <p role="status">{t("home.loading")}</p>}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: The page scroll accepts keyboard scrolling. */}
      <section ref={scroll} className="pdf-scroll" tabIndex={0} aria-label={t("documents.viewer")}>
        {pdf &&
          sizes?.map((size, i) => {
            const number = i + 1;
            return (
              <div
                key={number}
                className="pdf-sheet"
                data-page-number={number}
                style={
                  {
                    width: size.width * zoom,
                    height: size.height * zoom,
                    marginBottom: GAP,
                    "--total-scale-factor": zoom,
                  } as CSSProperties
                }
              >
                {Math.abs(number - current) <= AROUND && (
                  <PdfPage
                    pdf={pdf}
                    number={number}
                    zoom={zoom}
                    snippet={snippetFor(number)}
                    query={query}
                    rendered={(page, drawn) =>
                      setDrawn((set) => {
                        const next = new Set(set);
                        if (drawn) next.add(page);
                        else next.delete(page);
                        return next;
                      })
                    }
                  />
                )}
              </div>
            );
          })}
      </section>
      {sizes && <span className="pdf-indicator">{t("documents.pageOf", { page: current, count })}</span>}
      <details className="pdf-page-text">
        <summary>{t("documents.pageText", { page: current })}</summary>
        <section
          className="pdf-page-text-content"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Extracted page text has its own keyboard scroll region.
          tabIndex={0}
          aria-label={t("documents.pageText", { page: current })}
        >
          <pre>{content.pages[current - 1] || t("documents.reason.NEEDS_OCR")}</pre>
        </section>
      </details>
    </div>
  );
}
