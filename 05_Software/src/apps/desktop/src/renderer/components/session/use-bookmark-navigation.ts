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
  /** `quiet` arrivals come from the Bookmarks tab, which keeps focus. */
  onArrive: (id: string, ordinal: number, quiet: boolean) => void;
}) {
  const bindings = useContext(ShortcutContext);
  const tabs = useDocumentTabs();
  const shown = !tabs || tabs.active === CHAT;
  const [target, setTarget] = useState<{ id: string; quiet: boolean } | null>(null);
  const pending = target?.id ?? null;
  const setPending = (id: string | null, quiet = false) => setTarget(id === null ? null : { id, quiet });
  // Near neighbours and end-clamped jumps can share the reading line or scroll position.
  const last = useRef<{ id: string; top: number } | null>(null);
  const remember = (id: string) => {
    last.current = { id, top: viewport.current?.scrollTop ?? 0 };
    setPending(null);
  };
  const arrive = (id: string, quiet = false) => {
    if (!onNavigate(id)) return false;
    remember(id);
    onArrive(id, messages.findIndex((message) => message.id === id) + 1, quiet);
    return true;
  };
  useEffect(() => {
    if (!pending) return;
    if (!shown || !bookmarked(pending) || !messages.some((message) => message.id === pending)) {
      setPending(null);
      return;
    }
    if (layout.ids.includes(pending) && arrive(pending, target?.quiet)) setPending(null);
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
  /** Jump to a bookmarked message, mounting older history first when needed. */
  const go = (id: string, quiet: boolean) => {
    if (arrive(id, quiet)) setPending(null);
    else setPending(id, quiet);
  };
  return { remember, go };
}
