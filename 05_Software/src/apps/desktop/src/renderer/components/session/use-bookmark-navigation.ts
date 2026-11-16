import { type RefObject, useContext, useEffect, useRef, useState } from "react";
import { ShortcutContext, shortcutCommand } from "../../lib/shortcuts.js";
import { CHAT, useDocumentTabs } from "../documents/viewer-context.js";
import { currentIndex } from "./transcript-navigation.js";
import type { NavigatorMessage } from "./transcript-navigator.js";

/** Dispatch bookmark shortcuts through the same jump and focus path as the conversation rail. */
export function useBookmarkNavigation({
  viewport,
  messages,
  bookmarked,
  layout,
  onNavigate,
  onArrive,
}: {
  viewport: RefObject<HTMLDivElement | null>;
  messages: readonly NavigatorMessage[];
  bookmarked: (id: string) => boolean;
  layout: { ids: string[]; starts: number[]; height: number };
  onNavigate: (id: string) => boolean;
  onArrive: (id: string, ordinal: number) => void;
}) {
  const bindings = useContext(ShortcutContext);
  const tabs = useDocumentTabs();
  const shown = !tabs || tabs.active === CHAT;
  const [pending, setPending] = useState<string | null>(null);
  // Near neighbours and end-clamped jumps can share the reading line or scroll position.
  const last = useRef<{ id: string; top: number } | null>(null);
  const remember = (id: string) => {
    last.current = { id, top: viewport.current?.scrollTop ?? 0 };
    setPending(null);
  };
  const arrive = (id: string) => {
    if (!onNavigate(id)) return false;
    remember(id);
    onArrive(id, messages.findIndex((message) => message.id === id) + 1);
    return true;
  };
  useEffect(() => {
    if (!pending) return;
    if (!shown || !bookmarked(pending) || !messages.some((message) => message.id === pending)) {
      setPending(null);
      return;
    }
    if (layout.ids.includes(pending) && arrive(pending)) setPending(null);
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!shown) return;
      const command = shortcutCommand(event, bindings);
      if (command !== "nextBookmark" && command !== "previousBookmark") return;
      const node = viewport.current;
      if (!node) return;
      const currentId =
        pending ??
        (last.current?.top === node.scrollTop
          ? last.current.id
          : layout.ids[currentIndex(layout.starts, node.scrollTop, layout.height)]);
      const current = messages.findIndex((message) => message.id === currentId);
      const candidates = messages.filter(
        (message, index) =>
          bookmarked(message.id) && (command === "nextBookmark" ? index > current : index < current),
      );
      const target = command === "nextBookmark" ? candidates[0] : candidates.at(-1);
      event.preventDefault();
      if (!target) return;
      if (arrive(target.id)) setPending(null);
      else setPending(target.id);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  return remember;
}
