import { veraError } from "@vera/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorMessage } from "../error-message.js";
import { HexRows, type HexSelection, type HexWindow } from "./hex-rows.js";
import {
  HEX_WINDOW_BYTES,
  type HexFile,
  type HexMode,
  HexSource,
  hexPattern,
  parseHexOffset,
} from "./hex-source.js";
import type { DocumentPlace } from "./viewer-context.js";
import "./hex-viewer.css";

/** Read-only byte viewer; every async operation belongs to this mounted Display attempt. */
export function HexViewer({
  file,
  place,
  onPlace,
  retry,
  findRequest = 0,
  gotoRequest = 0,
}: {
  file: HexFile;
  retry?: (() => void) | undefined;
  place?: DocumentPlace | undefined;
  onPlace?: ((place: DocumentPlace) => void) | undefined;
  findRequest?: number;
  gotoRequest?: number;
}) {
  const { t } = useTranslation();
  const source = useRef<HexSource | undefined>(undefined);
  const body = useRef<HTMLElement>(null),
    search = useRef<HTMLInputElement>(null),
    goto = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState(place && "offset" in place ? place.offset : 0),
    [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<HexWindow>(),
    [error, setError] = useState<unknown>(),
    [invalid, setInvalid] = useState(false);
  const [selection, setSelection] = useState<HexSelection>(),
    [findOpen, setFindOpen] = useState(false),
    [gotoOpen, setGotoOpen] = useState(false);
  const [query, setQuery] = useState(""),
    [mode, setMode] = useState<HexMode>("hex"),
    [offset, setOffset] = useState("0");
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const operation = useRef<AbortController | undefined>(undefined),
    lastFind = useRef<number | undefined>(undefined);
  const focusAfterLoad = useRef(false);
  useEffect(() => {
    if (view && focusAfterLoad.current) {
      focusAfterLoad.current = false;
      body.current?.focus();
    }
  }, [view]);
  const report = useRef(onPlace);
  report.current = onPlace;
  const cancel = () => {
    operation.current?.abort();
    operation.current = undefined;
    setBusy(false);
  };
  useEffect(() => {
    const owned = new HexSource(file);
    source.current = owned;
    return () => {
      operation.current?.abort();
      owned.dispose();
      if (source.current === owned) source.current = undefined;
    };
  }, [file]);
  useEffect(() => {
    void attempt;
    const owned = source.current;
    if (!owned) return;
    const controller = new AbortController(),
      signal = controller.signal;
    const target = Math.max(0, Math.min(Math.max(0, file.size - 1), position));
    const start = Math.max(0, Math.floor(target / 16) * 16 - 128);
    setError(undefined);
    setView(undefined);
    void (async () => {
      await owned.verify(signal);
      const bytes = await owned.read(start, HEX_WINDOW_BYTES, signal, true);
      await owned.verify(signal);
      signal.throwIfAborted();
      setView({ offset: start, bytes, target });
      report.current?.({ offset: target });
    })().catch((failure) => {
      if (!signal.aborted) setError(failure);
    });
    return () => controller.abort();
  }, [file, position, attempt]);
  useEffect(() => {
    if (findRequest) setFindOpen(true);
  }, [findRequest]);
  useEffect(() => {
    if (gotoRequest) setGotoOpen(true);
  }, [gotoRequest]);
  useEffect(() => {
    if (findOpen) search.current?.focus();
  }, [findOpen]);
  useEffect(() => {
    if (gotoOpen) goto.current?.focus();
  }, [gotoOpen]);
  const navigate = (next: number) => {
    focusAfterLoad.current = body.current === document.activeElement;
    cancel();
    setInvalid(false);
    setNotice("");
    setPosition(Math.max(0, Math.min(Math.max(0, file.size - 1), next)));
  };
  const select = (next: number, extend: boolean) => {
    setSelection((current) => ({ anchor: extend ? (current?.anchor ?? next) : next, focus: next }));
    setInvalid(false);
  };
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    cancel();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setInvalid(false);
    setNotice("");
    setError(undefined);
    try {
      await work(controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure);
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        setBusy(false);
      }
    }
  };
  const find = () => {
    const owned = source.current;
    if (!owned) return;
    let pattern: Uint8Array;
    try {
      pattern = hexPattern(query, mode);
    } catch {
      setInvalid(true);
      return;
    }
    void run(async (signal) => {
      const found = await owned.find(pattern, Math.min(file.size, (lastFind.current ?? -1) + 1), signal);
      signal.throwIfAborted();
      if (found === null) {
        setNotice(t("documents.hexNoMatch"));
        return;
      }
      lastFind.current = found;
      setSelection({ anchor: found, focus: found + pattern.length - 1 });
      setPosition(found);
      setAttempt((value) => value + 1);
      setNotice(`0x${found.toString(16).toUpperCase()}`);
    });
  };
  const copy = (as: HexMode) => {
    const owned = source.current;
    if (!selection || !owned) return;
    if (Math.abs(selection.focus - selection.anchor) >= HEX_WINDOW_BYTES) {
      setInvalid(true);
      return;
    }
    void run(async (signal) => {
      const value = await owned.copy(selection.anchor, selection.focus, as, signal);
      signal.throwIfAborted();
      const field = document.createElement("textarea"),
        focused = document.activeElement;
      field.value = value;
      field.setAttribute("aria-hidden", "true");
      field.style.position = "fixed";
      field.style.left = "-10000px";
      document.body.append(field);
      field.focus();
      field.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } finally {
        field.remove();
        if (focused instanceof HTMLElement && focused.isConnected) focused.focus();
      }
      if (!copied) throw veraError("INTERNAL");
      setNotice(t("documents.copied"));
    });
  };
  const closeFields = () => {
    cancel();
    setFindOpen(false);
    setGotoOpen(false);
    if (body.current) body.current.focus();
    else focusAfterLoad.current = true;
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Delegated viewer shortcuts operate the focused byte region and its form fields.
    <div
      className="hex-viewer"
      data-hex-viewer
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        const mod = (event.ctrlKey || event.metaKey) && !event.altKey;
        if (mod && ["f", "g"].includes(event.key.toLowerCase())) {
          event.preventDefault();
          event.stopPropagation();
          if (event.key.toLowerCase() === "f") {
            setFindOpen(true);
            search.current?.focus();
          } else {
            setGotoOpen(true);
            goto.current?.focus();
          }
        }
        if (
          mod &&
          event.key.toLowerCase() === "c" &&
          !(event.target as Element).closest("input,select,textarea")
        ) {
          event.preventDefault();
          copy(event.shiftKey ? "text" : "hex");
        }
        if (event.key === "Escape" && (findOpen || gotoOpen || busy)) {
          event.preventDefault();
          event.stopPropagation();
          closeFields();
        }
      }}
    >
      <div className="hex-controls">
        <button
          type="button"
          data-hex-find-open
          onClick={() => {
            setFindOpen(true);
            search.current?.focus();
          }}
        >
          {t("documents.find")}
        </button>
        <button
          type="button"
          data-hex-goto-open
          onClick={() => {
            setGotoOpen(true);
            goto.current?.focus();
          }}
        >
          {t("documents.hexGoTo")}
        </button>
        <button type="button" data-hex-copy="hex" disabled={!selection || busy} onClick={() => copy("hex")}>
          {t("documents.hexCopy")}
        </button>
        <button type="button" data-hex-copy="text" disabled={!selection || busy} onClick={() => copy("text")}>
          {t("documents.hexCopyText")}
        </button>
        {busy && (
          <button type="button" data-hex-cancel onClick={cancel}>
            {t("workbench.cancel")}
          </button>
        )}
      </div>
      {findOpen && (
        <form
          className="hex-controls"
          data-hex-find-form
          onSubmit={(event) => {
            event.preventDefault();
            find();
          }}
        >
          <select
            aria-label={t("documents.hexFindMode")}
            value={mode}
            onChange={(event) => {
              cancel();
              setMode(event.target.value as HexMode);
              lastFind.current = undefined;
            }}
          >
            <option value="hex">{t("documents.hexSequence")}</option>
            <option value="text">{t("documents.hexUtf8")}</option>
          </select>
          <input
            ref={search}
            data-document-search
            aria-label={t("documents.find")}
            value={query}
            maxLength={12288}
            onChange={(event) => {
              cancel();
              setQuery(event.target.value);
              lastFind.current = undefined;
              setInvalid(false);
            }}
          />
          <button type="submit" disabled={busy}>
            {t("documents.hexFindNext")}
          </button>
          <button type="button" onClick={closeFields}>
            {t("documents.close")}
          </button>
        </form>
      )}
      {gotoOpen && (
        <form
          className="hex-controls"
          data-hex-goto-form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const next = parseHexOffset(offset, file.size);
              navigate(next);
              select(next, false);
            } catch {
              setInvalid(true);
            }
          }}
        >
          <label>
            {t("documents.hexOffset")}
            <input
              ref={goto}
              data-hex-offset
              value={offset}
              onChange={(event) => setOffset(event.target.value)}
            />
          </label>
          <button type="submit">{t("documents.hexGoTo")}</button>
          <button type="button" onClick={closeFields}>
            {t("documents.close")}
          </button>
        </form>
      )}
      <div className="hex-position">
        <input
          aria-label={t("documents.hexPosition")}
          type="range"
          min={0}
          max={Math.max(0, file.size - 1)}
          step={16}
          value={position}
          onChange={(event) => navigate(Number(event.target.value))}
        />
        <output>
          0x{position.toString(16).toUpperCase()} / {file.size}
        </output>
      </div>
      <div className="hex-status" role="status">
        {invalid ? <span data-hex-invalid>{t("documents.hexInvalid")}</span> : notice}
      </div>
      {error !== undefined ? (
        <div>
          <ErrorMessage error={error} />
          <button
            type="button"
            data-hex-retry
            onClick={() => {
              cancel();
              if (retry) retry();
              else setAttempt((value) => value + 1);
            }}
          >
            {t("settings.retry")}
          </button>
        </div>
      ) : view ? (
        <HexRows
          view={view}
          size={file.size}
          selection={selection}
          select={select}
          navigate={navigate}
          moved={(next) => report.current?.({ offset: next })}
          body={body}
        />
      ) : (
        <p role="status">{t("home.loading")}</p>
      )}
    </div>
  );
}
