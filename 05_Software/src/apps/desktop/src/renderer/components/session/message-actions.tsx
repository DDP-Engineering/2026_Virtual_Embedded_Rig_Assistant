import { type CommandBlockShell, type TerminalSummary, veraError, veraErrorSchema } from "@vera/shared";
import { Copy, Play } from "lucide-react";
import { type ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";
import { TerminalNavigation } from "../terminal-navigation.js";

/** Only explicit, supported shell labels opt a block into execution. */
export function blockShell(language: string): CommandBlockShell | undefined {
  if (["powershell", "pwsh", "ps1"].includes(language.toLowerCase())) return "powershell";
  if (language.toLowerCase() === "bash") return "bash";
  return undefined;
}

export function CopyAction({ text, response = false }: { text: string; response?: boolean }) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const label = response ? t("chatActions.copyResponse") : t("chatActions.copyCode");
  async function copy() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await api.invoke("app.clipboard.write", { text });
    } catch {
      setError({ ...veraError("INTERNAL"), messageKey: "chatActions.clipboardFailed" });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className={response ? "copy-response message-action" : "message-action"}
        aria-label={label}
        title={label}
        disabled={busy}
        onClick={() => {
          void copy();
        }}
      >
        <Copy aria-hidden="true" />
      </button>
      {error !== undefined && <ErrorMessage error={error} />}
    </>
  );
}

function TerminalChoice({
  terminals,
  shell,
  choose,
  cancel,
}: {
  terminals: TerminalSummary[];
  shell: CommandBlockShell;
  choose(id: string): void;
  cancel(): void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [id, setId] = useState(terminals[0]?.id ?? "");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="terminal-choice"
      aria-label={t("chatActions.destination")}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          choose(id);
        }}
      >
        <label>
          {t("chatActions.destination")}
          <select value={id} onChange={(event) => setId(event.target.value)}>
            <option value="">{t("chatActions.newCleanTerminal")}</option>
            {terminals.map((terminal) => (
              <option key={terminal.id} value={terminal.id}>
                {t("terminal.name", { number: terminal.number })} — {shell}
              </option>
            ))}
          </select>
        </label>
        <div className="actions">
          <button type="button" onClick={cancel}>
            {t("workbench.cancel")}
          </button>
          <button type="submit" className="primary">
            {t("chatActions.run")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Actions retain source text independently of syntax highlighting and rendered citations. */
export function CodeBlock({
  text,
  language,
  streaming,
  children,
}: {
  text: string;
  language: string;
  streaming: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const navigation = useContext(TerminalNavigation);
  const shell = blockShell(language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [choices, setChoices] = useState<TerminalSummary[]>();
  const pending = useRef(false);
  const live = useRef(true);
  const dispatching = useRef(false);
  const origin = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (busy || choices || !restoreFocus.current) return;
    restoreFocus.current = false;
    origin.current?.focus();
  }, [busy, choices]);
  const owner = navigation?.workbenchId;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  // An A → B → A switch must invalidate an earlier A request too.
  const scope = useMemo(() => ({ owner }), [owner]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    void scope;
    pending.current = false;
    dispatching.current = false;
    setBusy(false);
    setChoices(undefined);
    setError(undefined);
    restoreFocus.current = false;
  }, [scope]);
  const valid = () => live.current && owner !== undefined && currentScope.current === scope;
  function finish() {
    pending.current = false;
    dispatching.current = false;
    setBusy(false);
    setChoices(undefined);
  }
  async function dispatch(id: string) {
    if (!valid() || !shell || streaming || !pending.current || dispatching.current) return;
    dispatching.current = true;
    setChoices(undefined);
    try {
      await api.invoke("terminal.execute", { workbenchId: owner as string, id, shell, text });
      if (valid()) navigation?.reveal(id);
    } catch (failure) {
      if (valid()) setError(failure);
    } finally {
      if (valid()) finish();
    }
  }
  async function createAndDispatch() {
    if (!valid() || !shell || streaming || !pending.current || dispatching.current) return;
    dispatching.current = true;
    setChoices(undefined);
    try {
      const terminal = await api.invoke("terminal.create", {
        workbenchId: owner as string,
        cols: 80,
        rows: 24,
        shell,
      });
      if (!valid()) return;
      dispatching.current = false;
      await dispatch(terminal.id);
    } catch (failure) {
      if (valid()) {
        setError(failure);
        finish();
      }
    }
  }
  async function runNew() {
    if (!valid() || streaming || pending.current || !navigation?.available) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    await createAndDispatch();
  }
  async function run() {
    if (!valid() || !shell || streaming || pending.current || !navigation?.available) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const rows = await api.invoke("terminal.list", { workbenchId: owner as string });
      if (!valid()) return;
      const compatible = rows.filter((row) => row.running && row.shell === shell);
      if (compatible.length > 1) {
        setChoices(compatible);
        return;
      }
      if (compatible[0]) await dispatch(compatible[0].id);
      else await createAndDispatch();
    } catch (failure) {
      if (valid()) {
        setError(failure);
        finish();
      }
    }
  }
  const failure = veraErrorSchema.safeParse(error);
  const needsNew = failure.success && failure.data.messageKey === "chatActions.promptNotReady";
  return (
    <div className="chat-code-block">
      <div className="code-block-actions">
        <CopyAction text={text} />
        {shell && (
          <button
            ref={origin}
            type="button"
            className="message-action"
            data-run-block
            aria-label={t("chatActions.runShell", { shell })}
            title={t("chatActions.runShell", { shell })}
            disabled={streaming || busy || !navigation?.available}
            onClick={() => {
              void run();
            }}
          >
            <Play aria-hidden="true" />
          </button>
        )}
      </div>
      <pre>{children}</pre>
      {error !== undefined && <ErrorMessage error={error} />}
      {needsNew && (
        <button
          type="button"
          disabled={busy || streaming || !navigation?.available}
          onClick={() => {
            void runNew();
          }}
        >
          {t("chatActions.runNewTerminal")}
        </button>
      )}
      {choices && shell && (
        <TerminalChoice
          terminals={choices}
          shell={shell}
          choose={(id) => {
            if (id) void dispatch(id);
            else void createAndDispatch();
          }}
          cancel={() => {
            restoreFocus.current = true;
            finish();
          }}
        />
      )}
    </div>
  );
}
