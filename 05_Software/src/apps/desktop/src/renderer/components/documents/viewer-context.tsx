// REQ-UX-28ad0002
import { referenceLabel, type ViewerContent, veraError } from "@vera/shared";
import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";
import { Markdown } from "../session/markdown.js";
import { OpenExternally } from "./open-externally.js";

const PdfViewer = lazy(() => import("./pdf-viewer.js"));
// Retain exact portable target variants without workbench identity supplied by callers.
export type ViewerTarget =
  | { path: string }
  | { ref: string }
  | { downloadId: string }
  /**
   * A workbench file shown as plain text, indexed or not (TASK-66b7d4aa); `ignored` files have no
   * Open in default app, which PathGuard refuses (TASK-b34f2cc7).
   */
  | { textPath: string; ignored?: boolean }
  | { sessionId: string; messageId: string; ref: string };
const ViewerContext = createContext<((target: ViewerTarget) => void) | undefined>(undefined);
export function useDocumentViewer() {
  return useContext(ViewerContext);
}

interface RecentSource {
  key: string;
  /** Path or ref of the source; a download shows its file name once loaded. */
  label: string;
  target: ViewerTarget;
}
const RECENT_SOURCES = 10;
const sourceKey = (target: ViewerTarget) =>
  "downloadId" in target
    ? `download:${target.downloadId}`
    : "textPath" in target
      ? `text:${target.textPath}`
      : "sessionId" in target
        ? `citation:${target.sessionId}/${target.messageId}/${target.ref}`
        : "ref" in target
          ? `ref:${target.ref}`
          : `path:${target.path}`;
interface SourceState {
  target?: ViewerTarget | undefined;
  content?: ViewerContent | undefined;
  error?: unknown;
  attempt: number;
  recent: RecentSource[];
  /** Bumped on every open, so the shell can reveal the Source tab. */
  revision: number;
  /** Bumped on every close, so the shell can return to the tab the source was opened from. */
  closed: number;
  /**
   * Focuses the opener once it is visible again: "pending" while it is hidden, "lost" when it is
   * gone (the shell then focuses a stable fallback), "none" when nothing was waiting.
   */
  restoreFocus: () => "none" | "focused" | "pending" | "lost";
  open: (target: ViewerTarget) => void;
  retry: () => void;
  close: () => void;
  /** Set by open and consumed once by the panel, so switching tabs never steals focus. */
  focusRequest: { current: boolean };
}
const SourceContext = createContext<SourceState | undefined>(undefined);
export function useDocumentSource() {
  return useContext(SourceContext);
}

export function DocumentViewerProvider({
  workbenchId,
  scope: contextScope,
  children,
}: {
  workbenchId: string;
  scope?: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const scope = contextScope ?? workbenchId;
  const [selection, setSelection] = useState<{ target: ViewerTarget; scope: string }>();
  const target = selection?.scope === scope ? selection.target : undefined;
  const [attempt, setAttempt] = useState(0);
  const [content, setContent] = useState<ViewerContent>();
  const [error, setError] = useState<unknown>();
  const [recent, setRecent] = useState<RecentSource[]>([]);
  const [revision, setRevision] = useState(0);
  const [closed, setClosed] = useState(0);
  const origin = useRef<HTMLElement | null>(null),
    focusRequest = useRef(false),
    restore = useRef(false);
  const open = useCallback(
    (next: ViewerTarget) => {
      // Reopening from the Source panel itself keeps the control that first opened a source.
      const active = document.activeElement as HTMLElement | null;
      if (!active?.closest("[data-source-panel]")) origin.current = active;
      focusRequest.current = true;
      setContent(undefined);
      setError(undefined);
      setSelection({ target: next, scope });
      setAttempt((v) => v + 1);
      setRevision((v) => v + 1);
      const key = sourceKey(next);
      setRecent((list) => {
        const known = list.find((entry) => entry.key === key);
        const label =
          known?.label ??
          ("downloadId" in next
            ? t("downloads.title")
            : "textPath" in next
              ? next.textPath
              : "ref" in next
                ? next.ref
                : next.path);
        return [{ key, label, target: next }, ...list.filter((entry) => entry.key !== key)].slice(
          0,
          RECENT_SOURCES,
        );
      });
    },
    [scope, t],
  );
  // The opener may sit in a tab hidden behind Source; the shell asks again once it shows it.
  const restoreFocus = useCallback(() => {
    if (!restore.current) return "none" as const;
    const node = origin.current;
    if (!node?.isConnected) {
      restore.current = false;
      return "lost" as const;
    }
    if (node.closest("[hidden]")) return "pending" as const;
    restore.current = false;
    node.focus();
    return "focused" as const;
  }, []);
  const close = useCallback(() => {
    setSelection(undefined);
    restore.current = true;
    // A visible opener gets focus now; a hidden or removed one is settled by the shell.
    const node = origin.current;
    if (node?.isConnected && !node.closest("[hidden]")) {
      restore.current = false;
      node.focus();
    }
    setClosed((v) => v + 1);
  }, []);
  // A scope change (session, workbench or settings) also closes an open source, without moving
  // focus, so the shell leaves the Source tab the way it came.
  const open_ = useRef(false);
  open_.current = selection !== undefined;
  const scopeSeen = useRef(false);
  // Invalidate only source state; Shell/Welcome and their unsaved drafts stay mounted.
  useEffect(() => {
    void scope;
    const wasOpen = scopeSeen.current && open_.current;
    scopeSeen.current = true;
    restore.current = false;
    setSelection(undefined);
    setContent(undefined);
    setError(undefined);
    setRecent([]);
    if (wasOpen) setClosed((v) => v + 1);
  }, [scope]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the same authorized target.
  useEffect(() => {
    if (!target) return;
    let alive = true;
    setContent(undefined);
    setError(undefined);
    const request =
      "downloadId" in target
        ? api.invoke("downloads.open", { workbenchId, downloadId: target.downloadId })
        : "textPath" in target
          ? api.invoke("docs.read", { workbenchId, path: target.textPath })
          : api.invoke("docs.open", { workbenchId, ...target });
    void request
      .then((result) => {
        if (
          result.workbenchId !== workbenchId ||
          ("downloadId" in target
            ? !("downloadId" in result) || result.downloadId !== target.downloadId
            : "textPath" in target
              ? result.content.path !== target.textPath
              : "ref" in target
                ? result.content.ref !== target.ref
                : result.content.path !== target.path)
        )
          throw veraError("NOT_FOUND");
        if (!alive) return;
        setContent(result.content);
        if ("downloadId" in target) {
          const key = sourceKey(target),
            name = result.content.path.split("/").at(-1) ?? result.content.path;
          setRecent((list) => list.map((entry) => (entry.key === key ? { ...entry, label: name } : entry)));
        }
      })
      .catch((failure) => {
        if (alive) setError(failure);
      });
    return () => {
      alive = false;
    };
  }, [target, attempt, workbenchId]);
  const retry = useCallback(() => setAttempt((v) => v + 1), []);
  const state = useMemo(
    () => ({
      target,
      content,
      error,
      attempt,
      recent,
      revision,
      closed,
      open,
      retry,
      close,
      restoreFocus,
      focusRequest,
    }),
    [target, content, error, attempt, recent, revision, closed, open, retry, close, restoreFocus],
  );
  return (
    <ViewerContext.Provider value={open}>
      <SourceContext.Provider value={state}>{children}</SourceContext.Provider>
    </ViewerContext.Provider>
  );
}

/** The right panel's Source tab: the current source, its actions and the session's recent sources. */
export function SourcePanel() {
  const { t } = useTranslation();
  const state = useDocumentSource();
  const current = useRef<HTMLElement>(null);
  const revision = state?.revision ?? 0,
    target = state?.target;
  useEffect(() => {
    void revision;
    if (!state?.focusRequest.current || !target) return;
    state.focusRequest.current = false;
    // The body may already have focused its cited unit (it renders first when content is ready).
    if (!current.current?.contains(document.activeElement)) current.current?.focus();
  }, [revision, target, state]);
  if (!state) return null;
  const { content, error, attempt, recent } = state;
  const currentKey = target ? sourceKey(target) : undefined;
  return (
    <section
      data-source-panel
      className="source-panel"
      aria-label={t("panel.source")}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
          const search = event.currentTarget.querySelector<HTMLInputElement>("[data-document-search]");
          if (search) {
            event.preventDefault();
            event.stopPropagation();
            search.focus();
          }
        }
        if (event.key === "Escape" && target && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          state.close();
        }
      }}
    >
      {target ? (
        <section
          ref={current}
          data-source-current
          className="source-current"
          tabIndex={-1}
          aria-labelledby="document-title"
        >
          <header>
            <h2 id="document-title">{t("documents.viewer")}</h2>
            <button type="button" data-action="close-source" onClick={state.close}>
              {t("documents.closeSource")}
            </button>
            {content && content.kind !== "artifact" && !("textPath" in target && target.ignored) && (
              <OpenExternally path={content.path} />
            )}
          </header>
          <p className="document-path">
            {"downloadId" in target
              ? (content?.path ?? t("downloads.title"))
              : "textPath" in target
                ? target.textPath
                : "path" in target
                  ? target.path
                  : target.ref}
          </p>
          {error !== undefined ? (
            <>
              <ErrorMessage error={error} />
              <button type="button" onClick={state.retry}>
                {t("settings.retry")}
              </button>
            </>
          ) : content ? (
            <Suspense fallback={<p role="status">{t("home.loading")}</p>}>
              <DocumentBody key={attempt} content={content} />
            </Suspense>
          ) : (
            <p role="status">{t("home.loading")}</p>
          )}
        </section>
      ) : (
        <p className="muted">{t("documents.noSource")}</p>
      )}
      {recent.length > 0 && (
        <nav className="recent-sources" aria-label={t("documents.recentSources")}>
          <h3>{t("documents.recentSources")}</h3>
          <ul>
            {recent.map((entry) => (
              <li key={entry.key}>
                <button
                  type="button"
                  data-recent-source={entry.label}
                  title={entry.label}
                  aria-current={entry.key === currentKey ? "true" : undefined}
                  onClick={() => state.open(entry.target)}
                >
                  {"ref" in entry.target ? referenceLabel(entry.target.ref) : entry.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </section>
  );
}

export function DocumentBody({ content }: { content: ViewerContent }) {
  const { t } = useTranslation();
  const node = useRef<HTMLElement>(null);
  useEffect(() => {
    if (content.kind === "text")
      node.current?.querySelector(`[data-line="${content.start}"]`)?.scrollIntoView?.({ block: "center" });
    if (content.kind === "presentation") {
      const slide = node.current?.querySelector<HTMLElement>(`[data-slide="${content.page}"]`);
      slide?.scrollIntoView?.({ block: "start" });
      slide?.focus();
    }
    if ("anchor" in content && content.anchor !== null) {
      const anchor = [...(node.current?.querySelectorAll<HTMLElement>("[data-heading]") ?? [])].find(
        (el) => el.dataset.heading === content.anchor,
      );
      anchor?.scrollIntoView?.({ block: "start" });
      anchor?.focus();
    }
  }, [content]);
  if (content.kind === "pdf") return <PdfViewer content={content} />;
  if (content.kind === "text") return <TextViewer content={content} />;
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: Named document region supports keyboard scrolling.
    <section ref={node} className="document-body" aria-label={t("documents.viewer")} tabIndex={0}>
      {content.kind === "artifact" ? (
        <ArtifactBody content={content.content} mime={content.mime} />
      ) : content.kind === "presentation" ? (
        content.slides.map((text, i) => {
          const slide = i + 1;
          return (
            <section
              key={slide}
              data-slide={slide}
              tabIndex={-1}
              aria-current={slide >= content.page && slide <= content.pageEnd ? "true" : undefined}
            >
              <h3>{t("documents.slide", { number: slide })}</h3>
              <pre>{text}</pre>
            </section>
          );
        })
      ) : (
        content.sections.map((s) => (
          <section
            key={s.slug || "preamble"}
            data-heading={s.slug}
            id={s.slug ? `document-heading-${s.slug}` : undefined}
            tabIndex={-1}
            aria-current={s.slug === content.anchor ? "true" : undefined}
          >
            {content.kind === "markdown" ? <Markdown text={s.text} /> : <pre>{s.text}</pre>}
          </section>
        ))
      )}
    </section>
  );
}
function TextViewer({ content }: { content: Extract<ViewerContent, { kind: "text" }> }) {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(Math.max(1, content.start - 20));
  const node = useRef<HTMLElement>(null);
  const visible = content.lines
    .slice(offset - 1, offset + 249)
    .map((text, i) => ({ text, line: offset + i }));
  useEffect(() => {
    node.current
      ?.querySelector(
        `[data-line="${content.start >= offset && content.start < offset + 250 ? content.start : offset}"]`,
      )
      ?.scrollIntoView?.({ block: "center" });
  }, [offset, content.start]);
  return (
    <div className="text-viewer">
      <div className="document-toolbar">
        <button type="button" disabled={offset === 1} onClick={() => setOffset(Math.max(1, offset - 250))}>
          {t("documents.previousLines")}
        </button>
        <label>
          {t("documents.line")}
          <input
            type="number"
            min={1}
            max={content.lines.length || 1}
            value={offset}
            aria-label={t("documents.line")}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isInteger(next) && next >= 1 && next <= content.lines.length) setOffset(next);
            }}
          />
        </label>
        <span>
          {t("documents.lineCount", {
            start: offset,
            end: Math.min(offset + 249, content.lines.length),
            count: content.lines.length,
          })}
        </span>
        <button
          type="button"
          disabled={offset + 249 >= content.lines.length}
          onClick={() => setOffset(offset + 250)}
        >
          {t("documents.nextLines")}
        </button>
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Named text region supports keyboard scrolling. */}
      <section ref={node} className="document-body" aria-label={t("documents.viewer")} tabIndex={0}>
        <div className="document-lines">
          {visible.map(({ text, line }) => (
            <div
              key={line}
              data-line={line}
              aria-current={line >= content.start && line <= content.end ? "true" : undefined}
            >
              <span className="line-number">{line}</span>
              <span>{text || " "}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
export function ArtifactBody({ content, mime }: { content: string; mime: string }) {
  return mime === "text/markdown" ? <Markdown text={content} /> : <pre>{content}</pre>;
}
