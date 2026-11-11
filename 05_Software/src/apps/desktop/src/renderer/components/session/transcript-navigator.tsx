// REQ-UX-b2f6ffa8 REQ-UX-2bbfd052 REQ-UX-a3be2b11 REQ-UX-7b49305a REQ-UX-958b58c2 REQ-FUNC-1219a1e4 REQ-REL-c8ac2ecc
import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  contentOffset,
  currentIndex,
  groupMarkers,
  MARKER_SIZE,
  markerCenter,
  previewText,
} from "./transcript-navigation.js";

export type NavigatorMessage = { id: string; text: string; pending: boolean };
type Layout = { ids: string[]; starts: number[]; scrollHeight: number; height: number; width: number };
type Entry = { message: NavigatorMessage; ordinal: number };
type Group = { key: string; center: number; members: Entry[] };
const empty: Layout = { ids: [], starts: [], scrollHeight: 0, height: 0, width: 0 };
const sameLayout = (a: Layout, b: Layout) =>
  a.scrollHeight === b.scrollHeight &&
  a.height === b.height &&
  a.width === b.width &&
  a.ids.length === b.ids.length &&
  a.ids.every((id, index) => id === b.ids[index] && a.starts[index] === b.starts[index]);
/** Appended to repeat an identical announcement, so live regions read it again. */
const NO_BREAK_SPACE = "\u00a0";
const moves: Record<string, (index: number, last: number) => number> = {
  ArrowUp: (index) => Math.max(0, index - 1),
  ArrowDown: (index, last) => Math.min(last, index + 1),
  Home: () => 0,
  End: (_, last) => last,
};

/**
 * Lane of user-message markers beside the scroll rail, never inside role="scrollbar". Anchors are
 * measured at most once per frame after layout changes; scrolling only reads scrollTop.
 */
export function TranscriptNavigator({
  viewport,
  content,
  anchors,
  messages,
  controls,
  onNavigate,
}: {
  viewport: RefObject<HTMLDivElement | null>;
  content: RefObject<HTMLDivElement | null>;
  anchors: ReadonlyMap<string, HTMLElement>;
  messages: readonly NavigatorMessage[];
  controls: string;
  onNavigate: (id: string) => boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [layout, setLayout] = useState(empty);
  const [current, setCurrent] = useState(-1);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [selector, setSelector] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const lane = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const measured = useRef(empty);
  const measuredKey = useRef<string | null>(null);
  const latest = useRef(messages);
  const frame = useRef(0);
  const hide = useRef<ReturnType<typeof setTimeout>>(undefined);
  const focusWithin = useRef(false);
  const pressing = useRef(false);
  const enterSelector = useRef(false);
  const updateCurrent = useCallback(() => {
    const node = viewport.current;
    if (node) setCurrent(currentIndex(measured.current.starts, node.scrollTop, measured.current.height));
  }, [viewport]);
  const measure = useCallback(() => {
    frame.current = 0;
    const node = viewport.current;
    if (!node) return;
    const offset = contentOffset(node);
    const next: Layout = {
      ids: [],
      starts: [],
      scrollHeight: node.scrollHeight,
      height: node.clientHeight,
      width: node.clientWidth,
    };
    for (const message of latest.current) {
      const element = anchors.get(message.id);
      if (!element?.isConnected) continue;
      next.ids.push(message.id);
      next.starts.push(offset(element));
    }
    if (!sameLayout(measured.current, next)) {
      measured.current = next;
      setLayout(next);
    }
    updateCurrent();
  }, [viewport, anchors, updateCurrent]);
  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(measure);
  }, [measure]);
  // Passive, so the article refs of the same commit are attached (the lane precedes the transcript);
  // a new or removed message is measured on the next frame like every other invalidation.
  useEffect(() => {
    latest.current = messages;
    const key = messages.map((message) => message.id).join("\n");
    if (key === measuredKey.current) return;
    measuredKey.current = key;
    schedule();
  });
  useEffect(() => {
    const node = viewport.current;
    const inner = content.current;
    if (!node) return;
    node.addEventListener("scroll", updateCurrent, { passive: true });
    window.addEventListener("resize", schedule);
    document.fonts?.addEventListener("loadingdone", schedule);
    inner?.addEventListener("load", schedule, true);
    const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    resize?.observe(node);
    if (inner) resize?.observe(inner);
    const mutation = new MutationObserver(schedule);
    if (inner)
      mutation.observe(inner, {
        childList: true,
        subtree: true,
        characterData: true,
        attributeFilter: ["hidden", "open"],
      });
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      // A remount (StrictMode) measures again instead of relying on an observer's first callback.
      measuredKey.current = null;
      resize?.disconnect();
      mutation.disconnect();
      node.removeEventListener("scroll", updateCurrent);
      window.removeEventListener("resize", schedule);
      document.fonts?.removeEventListener("loadingdone", schedule);
      inner?.removeEventListener("load", schedule, true);
    };
  }, [viewport, content, schedule, updateCurrent]);
  useEffect(() => () => clearTimeout(hide.current), []);

  const groups = useMemo(() => {
    const ordinals = new Map(messages.map((message, index) => [message.id, { message, ordinal: index + 1 }]));
    const entries: (Entry & { y: number })[] = [];
    layout.ids.forEach((messageId, index) => {
      const entry = ordinals.get(messageId);
      if (entry) entries.push({ ...entry, y: layout.starts[index] ?? 0 });
    });
    return groupMarkers(
      entries.map((entry) => markerCenter(entry.y, layout.scrollHeight, layout.height)),
      layout.height,
    ).flatMap(({ center, members }): Group[] => {
      const list = members.flatMap((index) => entries[index] ?? []);
      const first = list[0];
      return first ? [{ key: first.message.id, center, members: list }] : [];
    });
  }, [layout, messages]);
  const visible = layout.scrollHeight - layout.height > 1 && groups.length > 0;
  const currentId = layout.ids[current];
  const holds = (group: Group, messageId: string | null | undefined) =>
    group.members.some((entry) => entry.message.id === messageId);
  const stop = (
    groups.find((group) => holds(group, focusId)) ?? groups.find((group) => holds(group, currentId))
  )?.key;
  const tabStop = stop ?? groups[0]?.key;
  const opened = selector === null ? undefined : groups.find((group) => holds(group, selector));
  const openGroup = visible && opened && opened.members.length > 1 ? opened : undefined;
  const previewGroup = visible && !openGroup ? groups.find((group) => group.key === preview) : undefined;
  const popupGroup = openGroup ?? previewGroup;
  const line = (entry: Entry) =>
    [
      t("chat.navigator.message", { ordinal: entry.ordinal }),
      ...(entry.message.pending ? [t("chat.pending")] : []),
      previewText(entry.message.text) || t("chat.navigator.empty"),
    ].join(" — ");
  const groupLabel = (group: Group) =>
    t("chat.navigator.group", {
      first: group.members[0]?.ordinal,
      last: group.members.at(-1)?.ordinal,
      count: group.members.length,
    });

  useLayoutEffect(() => {
    if (!visible) focusWithin.current = false;
    if (selector !== null && !openGroup) setSelector(null);
    if (enterSelector.current && openGroup && popup.current) {
      enterSelector.current = false;
      const entries = [...popup.current.querySelectorAll("button")];
      entries[
        Math.max(
          0,
          openGroup.members.findIndex((entry) => entry.message.id === currentId),
        )
      ]?.focus();
    } else if (focusWithin.current && (!document.activeElement || document.activeElement === document.body))
      if (tabStop) buttons.current.get(tabStop)?.focus();
    // CSS sizes the popup from the frame width; one read, then one write.
    const node = popup.current;
    if (!node || !popupGroup) return;
    const height = node.offsetHeight;
    node.style.top = `${Math.max(4, Math.min(popupGroup.center - height / 2, layout.height - height - 4))}px`;
  });
  // Attached in the same commit as a shown preview; consumed, so workspace Escape shortcuts (Stop)
  // yield. An open dialog keeps its own Escape.
  const previewShown = previewGroup !== undefined;
  useLayoutEffect(() => {
    if (!previewShown) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      setPreview(null);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [previewShown]);
  useEffect(() => {
    if (selector === null) return;
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (!popup.current?.contains(target) && !toolbar.current?.contains(target)) setSelector(null);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [selector]);

  const announce = (ordinal: number) => {
    const text = t("chat.navigator.moved", { ordinal });
    setStatus((previous) => (previous === text ? `${text}${NO_BREAK_SPACE}` : text));
  };
  const go = (entry: Entry) => {
    if (onNavigate(entry.message.id)) announce(entry.ordinal);
  };
  const activate = (group: Group) => {
    const only = group.members.length === 1 ? group.members[0] : undefined;
    if (only) {
      setSelector(null);
      go(only);
      return;
    }
    setPreview(null);
    enterSelector.current = selector !== group.key;
    setSelector((open) => (open === group.key ? null : group.key));
  };
  const choose = (group: Group, entry: Entry) => {
    setSelector(null);
    setFocusId(entry.message.id);
    buttons.current.get(group.key)?.focus();
    go(entry);
  };
  const leave = () => {
    clearTimeout(hide.current);
    hide.current = setTimeout(() => setPreview(null), 300);
  };
  const stay = () => clearTimeout(hide.current);
  if (!visible) return null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Tracks focus for regrouping and forwards wheel scrolling; the controls inside are buttons.
    <div
      className="transcript-navigator"
      ref={lane}
      style={{ "--navigator-frame": `${layout.width}px` } as CSSProperties}
      onFocus={() => {
        focusWithin.current = true;
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next) {
          focusWithin.current = event.currentTarget.contains(next);
          return;
        }
        const left = event.target;
        queueMicrotask(() => {
          if (left.isConnected) focusWithin.current = false;
        });
      }}
      onWheel={(event) => {
        const node = viewport.current;
        // The open selector scrolls its own list.
        if (openGroup && popup.current?.contains(event.target as Node)) return;
        if (node && !event.ctrlKey)
          node.scrollTop +=
            event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1);
      }}
    >
      <div
        role="toolbar"
        ref={toolbar}
        aria-label={t("chat.navigator.label")}
        aria-orientation="vertical"
        aria-controls={controls}
        onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            if (preview === null && selector === null) return;
            event.preventDefault();
            event.stopPropagation();
            setPreview(null);
            setSelector(null);
            return;
          }
          const index = groups.findIndex((group) => buttons.current.get(group.key) === event.target);
          const move = moves[event.key];
          if (index < 0 || !move) return;
          event.preventDefault();
          const next = groups[move(index, groups.length - 1)];
          if (!next) return;
          setFocusId(next.key);
          buttons.current.get(next.key)?.focus();
        }}
      >
        {groups.map((group) => {
          const single = group.members.length === 1;
          const expanded = openGroup?.key === group.key;
          return (
            <button
              key={group.key}
              type="button"
              ref={(node) => {
                if (node) buttons.current.set(group.key, node);
                else buttons.current.delete(group.key);
              }}
              data-nav-marker
              data-nav-members={group.members.length}
              tabIndex={group.key === tabStop ? 0 : -1}
              style={{ top: group.center - MARKER_SIZE / 2 }}
              aria-label={
                single
                  ? t("chat.navigator.message", { ordinal: group.members[0]?.ordinal })
                  : groupLabel(group)
              }
              aria-current={holds(group, currentId) ? "location" : undefined}
              aria-expanded={single ? undefined : expanded}
              aria-controls={expanded ? `${id}-selector` : undefined}
              aria-describedby={single && previewGroup?.key === group.key ? `${id}-preview` : undefined}
              onFocus={() => {
                if (!holds(group, focusId)) setFocusId(group.key);
                if (!openGroup) setPreview(group.key);
              }}
              onBlur={() => setPreview((shown) => (shown === group.key ? null : shown))}
              onPointerEnter={() => {
                stay();
                if (!openGroup) setPreview(group.key);
              }}
              onPointerLeave={() => {
                pressing.current = false;
                leave();
              }}
              onPointerDown={() => {
                pressing.current = true;
              }}
              onPointerUp={() => {
                pressing.current = false;
              }}
              onPointerCancel={() => {
                pressing.current = false;
              }}
              onClick={() => activate(group)}
            >
              {single ? null : group.members.length}
            </button>
          );
        })}
      </div>
      {openGroup ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: Keeps focus on the entries when the legend or a gap is pressed (the scrollbar belongs to the container); the controls inside are buttons.
        <div
          ref={popup}
          className="transcript-navigator-popup transcript-navigator-selector"
          onMouseDown={(event) => {
            const target = event.target as Element;
            if (target !== event.currentTarget && !target.closest("button")) event.preventDefault();
          }}
        >
          <fieldset
            id={`${id}-selector`}
            data-nav-selector
            onBlur={(event) => {
              const next = event.relatedTarget as Node | null;
              if (
                next &&
                (event.currentTarget.contains(next) || (pressing.current && toolbar.current?.contains(next)))
              )
                return;
              setSelector(null);
            }}
            onKeyDown={(event) => {
              const entries = [...event.currentTarget.querySelectorAll("button")];
              const index = entries.indexOf(event.target as HTMLButtonElement);
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setSelector(null);
                buttons.current.get(openGroup.key)?.focus();
                return;
              }
              const move = moves[event.key];
              if (index < 0 || !move || event.ctrlKey || event.metaKey || event.altKey) return;
              event.preventDefault();
              entries[move(index, entries.length - 1)]?.focus();
            }}
          >
            <legend>{groupLabel(openGroup)}</legend>
            <ul>
              {openGroup.members.map((entry) => (
                <li key={entry.message.id}>
                  <button
                    type="button"
                    className="transcript-navigator-entry"
                    aria-current={entry.message.id === currentId ? "location" : undefined}
                    onClick={() => choose(openGroup, entry)}
                  >
                    {line(entry)}
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
        </div>
      ) : previewGroup ? (
        <div
          ref={popup}
          id={`${id}-preview`}
          className="transcript-navigator-popup"
          role="tooltip"
          onPointerEnter={stay}
          onPointerLeave={leave}
        >
          {previewGroup.members.length === 1 && previewGroup.members[0]
            ? line(previewGroup.members[0])
            : groupLabel(previewGroup)}
        </div>
      ) : null}
      <span role="status" className="sr-only">
        {status}
      </span>
    </div>
  );
}
