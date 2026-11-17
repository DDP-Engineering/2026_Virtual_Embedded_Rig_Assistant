import type { ViewerContent } from "@vera/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorMessage } from "../error-message.js";
import { FindBar } from "./find-bar.js";
import { findLargeText, type LargeTextMatch, type LargeTextMatches } from "./large-text-find.js";
import { LargeTextIndex } from "./large-text-index.js";
import { LargeTextRows, type LocatedTextWindow } from "./large-text-rows.js";
import { type LargeTextFile, LargeTextSource, TEXT_SCAN_BYTES } from "./large-text-source.js";
import { readTextWindow } from "./large-text-window.js";
import { type TextEncoding, textEncodings } from "./text-encoding.js";
import type { DocumentPlace } from "./viewer-context.js";
import { ViewerToolbar } from "./viewer-toolbar.js";

/** Byte navigation, progressive sparse indexing and cancellable search without file-wide text state. */
export function LargeTextViewer({
  file,
  content,
  retry,
  place,
  onPlace,
  findRequest,
  gotoRequest,
}: {
  file: LargeTextFile;
  content?: Extract<ViewerContent, { kind: "text" }> | undefined;
  retry?: (() => void) | undefined;
  place?: DocumentPlace | undefined;
  onPlace?: ((place: DocumentPlace) => void) | undefined;
  findRequest: number;
  gotoRequest: number;
}) {
  const { t } = useTranslation();
  const [encoding, setEncoding] = useState<TextEncoding>(file.encoding);
  const [replace, setReplace] = useState(false);
  const [wrap, setWrap] = useState(false);
  const source = useMemo(() => new LargeTextSource(file), [file]);
  const index = useMemo(() => new LargeTextIndex(source, encoding), [source, encoding]);
  const [view, setView] = useState<LocatedTextWindow>();
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [binary, setBinary] = useState(false);
  const [error, setError] = useState<unknown>();
  const [bar, setBar] = useState<"find" | "goto">();
  const [query, setQuery] = useState("");
  const [goto, setGoto] = useState("");
  const [result, setResult] = useState<LargeTextMatches>();
  const match = useRef<LargeTextMatch | undefined>(undefined);
  const container = useRef<HTMLDivElement>(null);
  const operation = useRef<AbortController | undefined>(undefined);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastOffset = useRef(place && "scroll" in place ? place.scroll : 0);
  const serial = useRef(0);
  const initialLine = useRef(place && "line" in place ? place.line : (content?.start ?? 1));

  const cancel = () => {
    clearTimeout(debounce.current);
    operation.current?.abort();
    setBusy(false);
  };
  const run = (action: (signal: AbortSignal) => Promise<void>) => {
    cancel();
    const controller = new AbortController();
    operation.current = controller;
    setError(undefined);
    setBinary(false);
    setBusy(true);
    void action(controller.signal)
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setView(undefined);
        if (failure instanceof TypeError) setBinary(true);
        else setError(failure);
      })
      .finally(() => {
        if (operation.current === controller) setBusy(false);
      });
  };
  const show = async (target: number, signal: AbortSignal, exact = false) => {
    const window = await readTextWindow(source, encoding, replace, target, signal);
    const known = exact || window.offset <= index.cursor.offset;
    const line = known
      ? (await index.position(window.offset, signal)).line
      : index.cursor.offset > 0
        ? index.estimate(window.offset)
        : Math.max(
            1,
            Math.floor(
              (window.offset * (window.lines.length - 1)) / Math.max(1, window.end - window.offset),
            ) + 1,
          );
    await source.verify(signal);
    setView({ ...window, line, exact: known });
    setOffset(target);
    lastOffset.current = target;
    onPlace?.({ scroll: target });
    serial.current++;
    return window;
  };
  const navigate = (target: number) =>
    run(async (signal) => {
      const window = await show(target, signal);
      await index.extend(Math.max(TEXT_SCAN_BYTES, window.offset), signal);
      if (window.offset > 0) await show(target, signal, true);
    });
  const find = (value: string, forward: boolean, restart = false) =>
    run(async (signal) => {
      setResult(undefined);
      const from = restart ? 0 : (match.current?.line ?? view?.line ?? 0);
      const found = await findLargeText(
        source,
        index,
        encoding,
        replace,
        value.trim(),
        from,
        forward,
        signal,
        async (hit) => {
          match.current = hit;
          await show(hit.offset, signal);
        },
      );
      signal.throwIfAborted();
      setResult(found);
      match.current = found.hit;
    });
  const go = () => {
    const target = Number(goto);
    if (!Number.isSafeInteger(target) || target <= 0) return;
    run(async (signal) => {
      const estimate = Math.min(
        file.size,
        Math.max(
          0,
          (target - 1) *
            (index.cursor.offset > 0
              ? index.cursor.offset / Math.max(1, index.cursor.line - 1)
              : file.size / Math.max(1, ((view?.lines.length ?? 1) * file.size) / 65536)),
        ),
      );
      await show(estimate, signal);
      const position = await index.goToLine(target, signal);
      await show(position.offset, signal, true);
    });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: Source changes restart all state; event closures own cancellable operations.
  useEffect(() => {
    setView(undefined);
    setResult(undefined);
    match.current = undefined;
    if (lastOffset.current === 0 && initialLine.current > 1)
      run(async (signal) => {
        await show(0, signal);
        const target = await index.goToLine(initialLine.current, signal);
        await show(target.offset, signal, true);
        initialLine.current = 1;
      });
    else navigate(lastOffset.current);
    return () => {
      clearTimeout(debounce.current);
      operation.current?.abort();
      source.dispose();
    };
  }, [source, index, replace]);
  useEffect(() => {
    if (findRequest) setBar("find");
  }, [findRequest]);
  useEffect(() => {
    if (gotoRequest) setBar("goto");
  }, [gotoRequest]);
  const close = () => {
    cancel();
    setBar(undefined);
    setQuery("");
    container.current?.querySelector<HTMLElement>(".document-body")?.focus();
  };

  return (
    <div
      className="text-viewer"
      ref={container}
      data-large-text
      data-window-bytes={source.retainedBytes}
      data-index-checkpoints={index.checkpoints.length}
      data-index-offset={index.cursor.offset}
      data-byte-offset={offset}
      data-exact={view?.exact}
      data-window-revision={serial.current}
    >
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
          {!file.verified && (
            <label>
              {t("documents.encoding")}
              <select
                data-text-encoding
                value={encoding}
                onChange={(event) => {
                  cancel();
                  setEncoding(event.target.value as TextEncoding);
                  setReplace(false);
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
          <span
            className="text-scan-controls"
            aria-hidden={!busy}
            style={{ visibility: busy ? "visible" : "hidden" }}
          >
            <span role="status">{t("documents.scanning")}</span>
            <button type="button" data-text-cancel={busy ? "" : undefined} disabled={!busy} onClick={cancel}>
              {t("workbench.cancel")}
            </button>
          </span>
        </div>
      </ViewerToolbar>
      {bar === "find" && (
        <FindBar
          label={t("documents.find")}
          value={query}
          status={
            result === undefined
              ? undefined
              : t("documents.matchOf", { current: result.current, total: result.total })
          }
          change={(value) => {
            cancel();
            setQuery(value);
            setResult(undefined);
            match.current = undefined;
            if (value.trim()) debounce.current = setTimeout(() => find(value, true, true), 200);
          }}
          step={(forward) => {
            if (query.trim()) find(query, forward);
          }}
          close={close}
        />
      )}
      {bar === "goto" && (
        <FindBar
          numeric
          label={t("documents.goToLine")}
          value={goto}
          change={setGoto}
          step={go}
          close={close}
        />
      )}
      {error !== undefined && (
        <>
          <ErrorMessage error={error} />
          {retry && (
            <button type="button" onClick={retry}>
              {t("settings.retry")}
            </button>
          )}
        </>
      )}
      {binary && (
        <div>
          <p role="alert">{t("documents.textBinary")}</p>
          <button type="button" data-show-as-text onClick={() => setReplace(true)}>
            {t("documents.showAsText")}
          </button>
        </div>
      )}
      {view && (
        <div className="large-text-window">
          <LargeTextRows
            key={`${source.file.path}:${serial.current}`}
            view={view}
            wrap={wrap}
            query={query.trim()}
            size={file.size}
            citation={content?.ref ? { start: content.start, end: content.end } : undefined}
            navigate={navigate}
            moved={(byte) => {
              lastOffset.current = byte;
              setOffset(byte);
              onPlace?.({ scroll: byte });
            }}
          />
          <input
            type="range"
            className="text-byte-scroll"
            data-byte-scroll
            min={0}
            max={file.size}
            step={1}
            value={offset}
            aria-label={t("documents.bytePosition")}
            aria-valuetext={`${offset} / ${file.size}`}
            onChange={(event) => navigate(Number(event.target.value))}
          />
        </div>
      )}
    </div>
  );
}
