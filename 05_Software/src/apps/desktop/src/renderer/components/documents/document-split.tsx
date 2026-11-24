import { createContext, type RefObject, useContext, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CHAT } from "./viewer-context.js";

export const ChatBesideTab = createContext(false);

/** The transcript is visible as the active tab or as the left pane beside the active document. */
export function useChatVisible(active = CHAT) {
  return useContext(ChatBesideTab) || active === CHAT;
}

const minPaneWidth = 280;
const separatorWidth = 8;
const minSplitWidth = 640;

/** Split intent belongs to the shown session, and actual visibility follows the center width. */
export function useDocumentSplit(
  root: RefObject<HTMLDivElement | null>,
  scope: string | undefined,
  hasDocument: boolean,
) {
  const [width, setWidth] = useState(0);
  const [intent, setIntent] = useState<{ scope: string; balance: number }>();
  useLayoutEffect(() => {
    const node = root.current;
    if (!node || scope === undefined) return;
    const measure = () => setWidth(node.clientWidth);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [root, scope]);
  useLayoutEffect(() => {
    setIntent((current) => (current?.scope === scope ? current : undefined));
  }, [scope]);

  const requested = intent !== undefined && intent.scope === scope;
  const visible = requested && hasDocument && width >= minSplitWidth;
  const available = width - separatorWidth;
  const max = Math.max(minPaneWidth, available - minPaneWidth);
  const clamp = (value: number) => Math.max(minPaneWidth, Math.min(max, Math.round(value)));
  const leftWidth = clamp(available * (intent?.balance ?? 0.5));
  return {
    requested,
    visible,
    leftWidth,
    max,
    open: () => {
      if (scope) setIntent((current) => (current?.scope === scope ? current : { scope, balance: 0.5 }));
    },
    close: () => setIntent(undefined),
    resize: (next: number) => {
      if (!visible) return;
      setIntent((current) =>
        current && current.scope === scope ? { ...current, balance: clamp(next) / available } : current,
      );
    },
  };
}

/** A focusable divider controlling the primary (Chat) pane width in CSS pixels. */
export function DocumentSplitSeparator({
  chatId,
  width,
  max,
  resize,
}: {
  chatId: string;
  width: number;
  max: number;
  resize: (next: number) => void;
}) {
  const { t } = useTranslation();
  const drag = useRef<{ pointerId: number; start: number; width: number } | undefined>(undefined);
  const stopDrag = () => {
    drag.current = undefined;
  };
  return (
    <hr
      className="document-split-separator"
      tabIndex={0}
      aria-label={t("documents.resizeSplit")}
      aria-orientation="vertical"
      aria-controls={chatId}
      aria-valuemin={minPaneWidth}
      aria-valuemax={max}
      aria-valuenow={width}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, start: event.clientX, width };
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (active?.pointerId === event.pointerId) resize(active.width + event.clientX - active.start);
      }}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onLostPointerCapture={stopDrag}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Home") resize(minPaneWidth);
        else if (event.key === "End") resize(max);
        else resize(width + (event.key === "ArrowRight" ? 24 : -24));
      }}
    />
  );
}
