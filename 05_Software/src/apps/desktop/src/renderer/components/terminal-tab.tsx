import { type TerminalSummary, typographyDefaults } from "@vera/shared";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { terminalDocument } from "../lib/terminal-document.js";
import { ErrorMessage } from "./error-message.js";
import "@xterm/xterm/css/xterm.css";

function TerminalSurface({
  workbenchId,
  terminal,
  failure,
  freshTerminals,
}: {
  workbenchId: string;
  terminal: TerminalSummary;
  failure(error: unknown): void;
  freshTerminals: Set<string>;
}) {
  const { t } = useTranslation();
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!container.current) return;
    let live = true;
    let previous = "";
    let initial = true;
    let timer: ReturnType<typeof setTimeout>;
    const element = container.current;
    const root = element.ownerDocument.documentElement;
    const fontSize = () => {
      const value = Number.parseFloat(getComputedStyle(root).getPropertyValue("--code-font-size"));
      return Number.isFinite(value) && value > 0 ? value : typographyDefaults.codeFontSize;
    };
    const styles = terminalDocument(element.ownerDocument);
    const term = new Terminal({
      cursorBlink: true,
      disableStdin: true,
      scrollback: 3000,
      allowProposedApi: false,
      fontFamily: "Consolas, monospace",
      fontSize: fontSize(),
      screenReaderMode: true,
      documentOverride: styles.document,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    styles.open(() => term.open(element));
    const input = term.onData((data) => {
      void api.invoke("terminal.input", { workbenchId, id: terminal.id, data }).catch((error) => {
        if (live) failure(error);
      });
    });
    const resized = term.onResize(({ cols, rows }) => {
      if (cols < 2 || rows < 1 || cols > 500 || rows > 300) return;
      void api.invoke("terminal.resize", { workbenchId, id: terminal.id, cols, rows }).catch((error) => {
        if (live) failure(error);
      });
    });
    const size = () => {
      if (element.clientWidth && element.clientHeight) fit.fit();
    };
    const observer = new ResizeObserver(size);
    observer.observe(element);
    const preferences = new MutationObserver(() => {
      const value = fontSize();
      if (term.options.fontSize === value) return;
      term.options.fontSize = value;
      size();
    });
    preferences.observe(root, { attributes: true, attributeFilter: ["style"] });
    size();
    term.focus();
    async function poll() {
      try {
        const snapshot = await api.invoke("terminal.output", { workbenchId, id: terminal.id });
        if (!live) return;
        const append = snapshot.output.startsWith(previous);
        const replay = !append || (initial && !freshTerminals.has(terminal.id));
        // Parsing historical VT queries must not inject old device/cursor replies into the live shell.
        term.options.disableStdin = replay || !snapshot.running;
        if (!append) term.reset();
        const data = append ? snapshot.output.slice(previous.length) : snapshot.output;
        if (data) await new Promise<void>((parsed) => term.write(data, parsed));
        if (!live) return;
        previous = snapshot.output;
        freshTerminals.delete(terminal.id);
        initial = false;
        term.options.disableStdin = !snapshot.running;
      } catch (error) {
        if (live) failure(error);
      }
      if (live)
        timer = setTimeout(() => {
          void poll();
        }, 250);
    }
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
      observer.disconnect();
      preferences.disconnect();
      input.dispose();
      resized.dispose();
      term.dispose();
      styles.dispose();
    };
  }, [workbenchId, terminal.id, failure, freshTerminals]);
  return (
    <section
      className="terminal-surface"
      ref={container}
      aria-label={t("terminal.input")}
      data-terminal-id={terminal.id}
      data-shortcut-capture
    />
  );
}

/** User-owned terminals survive panel navigation; the host closes them with the workbench. */
export function TerminalTab({ workbenchId }: { workbenchId: string }) {
  const { t } = useTranslation();
  const [terminals, setTerminals] = useState<TerminalSummary[]>([]);
  const [active, setActive] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const revision = useRef(0);
  const freshTerminals = useRef(new Set<string>());
  const selected = terminals.find((terminal) => terminal.id === active);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load(initial: boolean) {
      const version = revision.current;
      try {
        let rows = await api.invoke("terminal.list", { workbenchId });
        if (!live) return;
        if (version === revision.current && initial && !rows.length) {
          const created = await api.invoke("terminal.create", { workbenchId, cols: 80, rows: 24 });
          if (live) freshTerminals.current.add(created.id);
          rows = [created];
        }
        if (!live) return;
        if (version === revision.current) {
          setTerminals(rows);
          setActive((current) => (rows.some((row) => row.id === current) ? current : rows[0]?.id));
        }
      } catch (failure) {
        if (live) setError(failure);
      }
      if (live)
        timer = setTimeout(() => {
          void load(false);
        }, 1000);
    }
    void load(true);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [workbenchId]);
  async function create() {
    revision.current++;
    setPending(true);
    setError(undefined);
    try {
      const terminal = await api.invoke("terminal.create", { workbenchId, cols: 80, rows: 24 });
      freshTerminals.current.add(terminal.id);
      setTerminals((rows) => [...rows, terminal]);
      setActive(terminal.id);
    } catch (failure) {
      setError(failure);
    } finally {
      revision.current++;
      setPending(false);
    }
  }
  async function close() {
    if (!selected) return;
    revision.current++;
    setPending(true);
    setError(undefined);
    try {
      await api.invoke("terminal.close", { workbenchId, id: selected.id });
      freshTerminals.current.delete(selected.id);
      setTerminals((rows) => rows.filter((row) => row.id !== selected.id));
      setActive(terminals.find((row) => row.id !== selected.id)?.id);
    } catch (failure) {
      setError(failure);
    } finally {
      revision.current++;
      setPending(false);
    }
  }
  async function consent(shared: boolean) {
    if (!selected) return;
    revision.current++;
    setPending(true);
    setError(undefined);
    try {
      const terminal = await api.invoke("terminal.consent", { workbenchId, id: selected.id, shared });
      setTerminals((rows) => rows.map((row) => (row.id === terminal.id ? terminal : row)));
    } catch (failure) {
      setError(failure);
    } finally {
      revision.current++;
      setPending(false);
    }
  }
  return (
    <section className="terminal-panel" aria-label={t("panel.terminal")}>
      <div className="terminal-toolbar">
        <div className="terminal-actions">
          <button
            type="button"
            onClick={() => {
              void create();
            }}
            aria-label={t("terminal.new")}
            title={t("terminal.new")}
            disabled={pending || terminals.length >= 8}
          >
            <Plus aria-hidden="true" />
          </button>
          {selected && (
            <button
              type="button"
              onClick={() => {
                void close();
              }}
              aria-label={t("terminal.close")}
              title={t("terminal.close")}
              disabled={pending}
            >
              <X aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="terminal-tabs" role="tablist" aria-label={t("terminal.tabs")}>
          {terminals.map((terminal) => (
            <button
              type="button"
              key={terminal.id}
              role="tab"
              aria-selected={terminal.id === active}
              aria-controls="terminal-active"
              id={`terminal-${terminal.id}`}
              onClick={() => setActive(terminal.id)}
            >
              {t("terminal.name", { number: terminal.number })}
              {!terminal.running && ` (${terminal.exitCode ?? ""})`}
            </button>
          ))}
        </div>
      </div>
      {error !== undefined && <ErrorMessage error={error} />}
      {selected && (
        <>
          <label className="terminal-consent">
            <input
              type="checkbox"
              checked={selected.shared}
              disabled={pending}
              onChange={(event) => {
                void consent(event.target.checked);
              }}
            />
            {t("terminal.consent")}
          </label>
          <div id="terminal-active" role="tabpanel" aria-labelledby={`terminal-${selected.id}`}>
            <TerminalSurface
              key={selected.id}
              workbenchId={workbenchId}
              terminal={selected}
              failure={setError}
              freshTerminals={freshTerminals.current}
            />
          </div>
        </>
      )}
    </section>
  );
}
