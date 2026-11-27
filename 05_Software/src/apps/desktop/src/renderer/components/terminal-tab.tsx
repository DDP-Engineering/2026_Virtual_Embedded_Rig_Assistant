import { type TerminalRevision, type TerminalSummary, typographyDefaults } from "@vera/shared";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Plus, X } from "lucide-react";
import { type RefObject, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { appAdvancedValue, useAppAdvanced } from "../hooks/app-advanced.js";
import { terminalDocument } from "../lib/terminal-document.js";
import { ErrorMessage } from "./error-message.js";
import { TerminalNavigation } from "./terminal-navigation.js";
import "@xterm/xterm/css/xterm.css";

// A successful chat dispatch proves this is first use. Claim that live-output handoff once, not on panel replay.
const openedCommandTargets = new WeakSet<object>();

function TerminalSurface({
  workbenchId,
  terminal,
  failure,
  freshTerminals,
  closingTerminal,
}: {
  workbenchId: string;
  terminal: TerminalSummary;
  failure(error: unknown): void;
  freshTerminals: Set<string>;
  closingTerminal: RefObject<string | undefined>;
}) {
  const { t } = useTranslation();
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!container.current) return;
    let live = true;
    const available = () => live && closingTerminal.current !== terminal.id;
    let previous = "";
    let start = 0;
    let revision: TerminalRevision | undefined;
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
      // Read as the view opens; an open view keeps its scrollback (REQ-UX-996ae06e).
      scrollback: appAdvancedValue("terminalScrollback"),
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
      if (!available()) return;
      void api.invoke("terminal.input", { workbenchId, id: terminal.id, data }).then(
        () => {
          if (available()) wake();
        },
        (error) => {
          if (available()) failure(error);
        },
      );
    });
    const resized = term.onResize(({ cols, rows }) => {
      if (!available() || cols < 2 || rows < 1 || cols > 500 || rows > 300) return;
      void api.invoke("terminal.resize", { workbenchId, id: terminal.id, cols, rows }).catch((error) => {
        if (available()) failure(error);
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
    let polling = false;
    let wakePending = false;
    function schedule(delay: number) {
      clearTimeout(timer);
      timer = setTimeout(() => void poll(), delay);
    }
    function wake() {
      if (polling) wakePending = true;
      else schedule(25);
    }
    async function poll() {
      polling = true;
      try {
        if (!available()) return;
        const snapshot = await api.invoke("terminal.output", {
          workbenchId,
          id: terminal.id,
          ...(revision && { revision }),
        });
        if (!available()) return;
        if ("unchanged" in snapshot) {
          term.options.disableStdin = !snapshot.running;
          return;
        }
        // A full host buffer drops its head on new output: compare only the part of the last
        // snapshot that the host still holds, so a trimmed head is an append and not a redraw.
        const kept = previous.slice(Math.max(0, snapshot.start - start));
        // Older scrollback can also contain text that the new masking policy hides.
        const append =
          (!revision || revision.masking === snapshot.revision.masking) && snapshot.output.startsWith(kept);
        const replay = !append || (initial && !freshTerminals.has(terminal.id));
        // Parsing historical VT queries must not inject old device/cursor replies into the live shell.
        term.options.disableStdin = replay || !snapshot.running;
        if (!append) term.reset();
        const data = append ? snapshot.output.slice(kept.length) : snapshot.output;
        if (data) await new Promise<void>((parsed) => term.write(data, parsed));
        if (!live) return;
        previous = snapshot.output;
        start = snapshot.start;
        revision = snapshot.revision;
        freshTerminals.delete(terminal.id);
        initial = false;
        term.options.disableStdin = !snapshot.running;
      } catch (error) {
        if (available()) failure(error);
      } finally {
        polling = false;
        if (live) schedule(wakePending ? 25 : 250);
        wakePending = false;
      }
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
  }, [workbenchId, terminal.id, failure, freshTerminals, closingTerminal]);
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
  const maxTerminals = useAppAdvanced("terminals");
  const navigation = useContext(TerminalNavigation);
  const target = navigation?.workbenchId === workbenchId ? navigation.target : undefined;
  const requested = useRef(target);
  requested.current = target;
  const [terminals, setTerminals] = useState<TerminalSummary[]>([]);
  const [active, setActive] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const revision = useRef(0);
  const freshTerminals = useRef(new Set<string>());
  const closingTerminal = useRef<string | undefined>(undefined);
  const selected = terminals.find((terminal) => terminal.id === active);
  useEffect(() => {
    if (!target) return;
    if (!openedCommandTargets.has(target)) {
      openedCommandTargets.add(target);
      freshTerminals.current.add(target.id);
    }
    setActive(target.id);
    const timer = window.setTimeout(
      () =>
        document.querySelector<HTMLTextAreaElement>(`[data-terminal-id="${target.id}"] textarea`)?.focus(),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [target]);
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
          setActive((current) =>
            rows.some((row) => row.id === current)
              ? current
              : (rows.find((row) => row.id === requested.current?.id)?.id ?? rows[0]?.id),
          );
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
    // Suspend I/O before the host can delete the terminal; React unmounts its surface after close resolves.
    closingTerminal.current = selected.id;
    revision.current++;
    setPending(true);
    setError(undefined);
    try {
      await api.invoke("terminal.close", { workbenchId, id: selected.id });
      freshTerminals.current.delete(selected.id);
      setTerminals((rows) => rows.filter((row) => row.id !== selected.id));
      setActive(terminals.find((row) => row.id !== selected.id)?.id);
    } catch (failure) {
      closingTerminal.current = undefined;
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
            disabled={pending || terminals.length >= maxTerminals}
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
              closingTerminal={closingTerminal}
            />
          </div>
        </>
      )}
    </section>
  );
}
