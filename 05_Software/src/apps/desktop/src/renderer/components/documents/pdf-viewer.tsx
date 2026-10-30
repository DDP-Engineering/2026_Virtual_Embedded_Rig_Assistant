// REQ-UX-28ad0002
import type { ViewerContent } from "@vera/shared";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type RenderTask,
  TextLayer,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

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

export default function PdfViewer({ content }: { content: Extract<ViewerContent, { kind: "pdf" }> }) {
  const { t } = useTranslation();
  const [pdf, setPdf] = useState<PDFDocumentProxy>(),
    [error, setError] = useState(false),
    [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(content.page),
    [zoom, setZoom] = useState(1),
    [query, setQuery] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null),
    sheet = useRef<HTMLDivElement>(null);
  const matches = query.trim()
    ? content.pages.flatMap((value, i) => (normalize(value).includes(normalize(query)) ? [i + 1] : []))
    : [];
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt retries parsing/rendering after a PDF error.
  useEffect(() => {
    setError(false);
    setPdf(undefined);
    setReady(false);
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
      .then((doc) => {
        if (doc.numPages !== content.pages.length) throw Error("Page count mismatch");
        if (alive) setPdf(doc);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
      void loading.destroy();
    };
  }, [content, attempt]);
  useEffect(() => {
    if (!pdf) return;
    let alive = true,
      render: RenderTask | undefined,
      layer: TextLayer | undefined;
    setReady(false);
    void (async () => {
      const docPage = await pdf.getPage(page);
      if (!alive || !canvas.current || !text.current || !sheet.current) return;
      const viewport = docPage.getViewport({ scale: zoom });
      if (viewport.width <= 0 || viewport.height <= 0 || viewport.width * viewport.height > 16000000)
        throw Error("Page exceeds canvas budget");
      const el = canvas.current,
        container = text.current;
      el.width = Math.ceil(viewport.width);
      el.height = Math.ceil(viewport.height);
      sheet.current.style.width = `${viewport.width}px`;
      sheet.current.style.height = `${viewport.height}px`;
      container.replaceChildren();
      container.style.setProperty("--total-scale-factor", String(zoom));
      const context = el.getContext("2d");
      if (!context) throw Error("Canvas unavailable");
      render = docPage.render({ canvas: el, canvasContext: context, viewport });
      layer = new TextLayer({ container, viewport, textContentSource: await docPage.getTextContent() });
      await Promise.all([render.promise, layer.render()]);
      if (alive) {
        setReady(true);
      }
    })().catch(() => {
      if (alive) setError(true);
    });
    return () => {
      alive = false;
      render?.cancel();
      layer?.cancel();
    };
  }, [pdf, page, zoom]);
  useEffect(() => {
    if (ready && text.current) {
      const current = content.pages[page - 1] ?? "";
      const snippet =
        current && normalize(content.snippet).includes(normalize(current)) ? current : content.snippet;
      highlightText(text.current, page >= content.page && page <= content.pageEnd ? snippet : "", query);
    }
  }, [ready, query, page, content]);
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
    <div className="pdf-viewer" data-page={page} data-ready={ready}>
      <div className="document-toolbar">
        <button type="button" disabled={page === 1} onClick={() => setPage((n) => n - 1)}>
          {t("documents.previous")}
        </button>
        <label>
          {t("documents.page")}
          <input
            type="number"
            aria-label={t("documents.page")}
            min={1}
            max={content.pages.length}
            value={page}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= content.pages.length) setPage(n);
            }}
          />
        </label>
        <span>{t("documents.pageCount", { count: content.pages.length })}</span>
        <button type="button" disabled={page === content.pages.length} onClick={() => setPage((n) => n + 1)}>
          {t("documents.next")}
        </button>
        <label>
          {t("documents.zoom")}
          <select
            aria-label={t("documents.zoom")}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
              <option key={value} value={value}>
                {value * 100}%
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("documents.find")}
          <input
            data-document-search
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches.length)
                setPage(matches.find((n) => n > page) ?? matches[0] ?? page);
            }}
          />
        </label>
        {query.trim() && (
          <>
            <span role="status">{t("documents.matches", { count: matches.length })}</span>
            <button
              type="button"
              disabled={!matches.length}
              onClick={() => setPage(matches.find((n) => n > page) ?? matches[0] ?? page)}
            >
              {t("documents.nextMatch")}
            </button>
          </>
        )}
      </div>
      {content.ref !== null && (
        <p>{t("documents.citedPages", { start: content.page, end: content.pageEnd })}</p>
      )}
      <details className="pdf-page-text">
        <summary>{t("documents.pageText", { page })}</summary>
        <section
          className="pdf-page-text-content"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Extracted page text has its own keyboard scroll region.
          tabIndex={0}
          aria-label={t("documents.pageText", { page })}
        >
          <pre>{content.pages[page - 1] || t("documents.reason.NEEDS_OCR")}</pre>
        </section>
      </details>
      {!ready && <p role="status">{t("home.loading")}</p>}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable PDF page accepts keyboard scrolling. */}
      <section className="pdf-scroll" tabIndex={0} aria-label={t("documents.page")}>
        <div ref={sheet} className="pdf-sheet" style={{ "--total-scale-factor": zoom } as CSSProperties}>
          <canvas ref={canvas} aria-label={t("documents.page")} />
          <div ref={text} className="pdf-text-layer" aria-hidden="true" />
        </div>
      </section>
    </div>
  );
}
