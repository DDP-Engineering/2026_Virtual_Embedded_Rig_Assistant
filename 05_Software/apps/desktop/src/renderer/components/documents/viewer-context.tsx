// REQ-UX-28ad0002
import { type ViewerContent, veraError } from "@vera/shared";
import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";
import { Markdown } from "../session/markdown.js";

const PdfViewer = lazy(() => import("./pdf-viewer.js"));
// Retain exact portable target variants without workbench identity supplied by callers.
export type ViewerTarget =
  | { path: string }
  | { ref: string }
  | { sessionId: string; messageId: string; ref: string };
const ViewerContext = createContext<((target: ViewerTarget) => void) | undefined>(undefined);
export function useDocumentViewer() {
  return useContext(ViewerContext);
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
  const dialog = useRef<HTMLDialogElement>(null),
    origin = useRef<HTMLElement | null>(null);
  const open = useCallback(
    (next: ViewerTarget) => {
      origin.current = document.activeElement as HTMLElement;
      setContent(undefined);
      setError(undefined);
      setSelection({ target: next, scope });
      setAttempt((v) => v + 1);
    },
    [scope],
  );
  const close = () => {
    dialog.current?.close();
    setSelection(undefined);
    origin.current?.focus();
  };
  // Invalidate only modal state; Shell/Welcome and their unsaved drafts stay mounted.
  useEffect(() => {
    void scope;
    setSelection(undefined);
    setContent(undefined);
    setError(undefined);
  }, [scope]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the same authorized target.
  useEffect(() => {
    if (!target) return;
    let alive = true;
    if (!dialog.current?.open) dialog.current?.showModal();
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    setContent(undefined);
    setError(undefined);
    void api
      .invoke("docs.open", { workbenchId, ...target })
      .then((result) => {
        if (
          result.workbenchId !== workbenchId ||
          ("ref" in target ? result.content.ref !== target.ref : result.content.path !== target.path)
        )
          throw veraError("NOT_FOUND");
        if (alive) setContent(result.content);
      })
      .catch((failure) => {
        if (alive) setError(failure);
      });
    return () => {
      alive = false;
    };
  }, [target, attempt, workbenchId]);
  return (
    <ViewerContext.Provider value={open}>
      {children}
      {target && (
        <dialog
          ref={dialog}
          className="document-dialog"
          aria-labelledby="document-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
              event.preventDefault();
              event.stopPropagation();
              dialog.current?.querySelector<HTMLInputElement>("[data-document-search]")?.focus();
            }
            if (event.key === "Escape") event.stopPropagation();
          }}
        >
          <header>
            <h2 id="document-title">{t("documents.viewer")}</h2>
            <button type="button" onClick={close}>
              {t("panel.close")}
            </button>
          </header>
          <p className="document-path">{"path" in target ? target.path : target.ref}</p>
          {error !== undefined ? (
            <>
              <ErrorMessage error={error} />
              <button type="button" onClick={() => setAttempt((v) => v + 1)}>
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
        </dialog>
      )}
    </ViewerContext.Provider>
  );
}

export function DocumentBody({ content }: { content: ViewerContent }) {
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (content.kind === "text")
      node.current?.querySelector(`[data-line="${content.start}"]`)?.scrollIntoView?.({ block: "center" });
    if ((content.kind === "markdown" || content.kind === "html") && content.anchor) {
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
    <div ref={node} className="document-body">
      {content.kind === "artifact" ? (
        <ArtifactBody content={content.content} mime={content.mime} />
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
    </div>
  );
}
function TextViewer({ content }: { content: Extract<ViewerContent, { kind: "text" }> }) {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(Math.max(1, content.start - 20));
  const node = useRef<HTMLDivElement>(null);
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
          {t("documents.previous")}
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
          {t("documents.next")}
        </button>
      </div>
      <div ref={node} className="document-body">
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
      </div>
    </div>
  );
}
export function ArtifactBody({ content, mime }: { content: string; mime: string }) {
  return mime === "text/markdown" ? <Markdown text={content} /> : <pre>{content}</pre>;
}
