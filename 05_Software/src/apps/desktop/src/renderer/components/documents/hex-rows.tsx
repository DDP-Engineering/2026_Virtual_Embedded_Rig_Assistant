import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatHexRow, hexByte } from "./hex-source.js";

export interface HexWindow {
  offset: number;
  bytes: Uint8Array;
  target: number;
}
export type HexSelection = { anchor: number; focus: number };
/** Only visible rows of a bounded byte window are mounted; the byte slider spans the file. */
export function HexRows({
  view,
  size,
  selection,
  select,
  navigate,
  moved,
  body,
}: {
  view: HexWindow;
  size: number;
  selection: HexSelection | undefined;
  select: (offset: number, extend: boolean) => void;
  navigate: (offset: number) => void;
  moved: (offset: number) => void;
  body: React.RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const probe = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ top: 0, height: 600, row: 24 });
  const count = Math.ceil(view.bytes.length / 16),
    first = Math.max(0, Math.floor(geometry.top / geometry.row) - 8);
  const last = Math.min(count, first + Math.min(100, Math.ceil(geometry.height / geometry.row) + 16));
  const start = Math.min(selection?.anchor ?? -1, selection?.focus ?? -1),
    end = Math.max(selection?.anchor ?? -1, selection?.focus ?? -1);
  useLayoutEffect(() => {
    const node = body.current;
    if (!node) return;
    const measure = () =>
      setGeometry({
        top: node.scrollTop,
        height: node.clientHeight || 600,
        row: probe.current?.getBoundingClientRect().height || 24,
      });
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(node);
    if (probe.current) observer?.observe(probe.current);
    return () => observer?.disconnect();
  }, [body]);
  useEffect(() => {
    const node = body.current;
    if (!node) return;
    node.scrollTop = Math.floor((view.target - view.offset) / 16) * geometry.row;
    setGeometry((current) => ({ ...current, top: node.scrollTop }));
  }, [view, body, geometry.row]);
  return (
    <section
      ref={body}
      className="document-body hex-rows"
      data-hex-rows
      aria-label={t("documents.hexView")}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Named byte region owns keyboard selection and scrolling.
      tabIndex={0}
      onScroll={(event) => {
        const top = event.currentTarget.scrollTop;
        setGeometry((current) => ({ ...current, top }));
        moved(view.offset + Math.floor(top / geometry.row) * 16);
      }}
      onWheel={(event) => {
        const node = event.currentTarget;
        if (
          event.deltaY > 0 &&
          node.scrollTop + node.clientHeight >= node.scrollHeight - 2 &&
          view.offset + view.bytes.length < size
        ) {
          event.preventDefault();
          navigate(view.offset + view.bytes.length - 128);
        } else if (event.deltaY < 0 && node.scrollTop <= 0 && view.offset > 0) {
          event.preventDefault();
          navigate(Math.max(0, view.offset - 48000));
        }
      }}
      onKeyDown={(event) => {
        if (event.altKey || event.nativeEvent.isComposing) return;
        const focus = selection?.focus ?? view.target,
          mod = event.ctrlKey || event.metaKey;
        let next =
          event.key === "ArrowRight"
            ? focus + 1
            : event.key === "ArrowLeft"
              ? focus - 1
              : event.key === "ArrowDown"
                ? focus + 16
                : event.key === "ArrowUp"
                  ? focus - 16
                  : event.key === "PageDown"
                    ? focus + 16 * Math.max(1, Math.floor(geometry.height / geometry.row))
                    : event.key === "PageUp"
                      ? focus - 16 * Math.max(1, Math.floor(geometry.height / geometry.row))
                      : event.key === "Home"
                        ? mod
                          ? 0
                          : Math.floor(focus / 16) * 16
                        : event.key === "End"
                          ? mod
                            ? size - 1
                            : Math.floor(focus / 16) * 16 + 15
                          : undefined;
        if (next === undefined || size === 0) return;
        event.preventDefault();
        next = Math.max(0, Math.min(size - 1, next));
        select(next, event.shiftKey);
        const row = Math.floor((next - view.offset) / 16),
          top = row * geometry.row,
          node = event.currentTarget;
        if (next < view.offset || next >= view.offset + view.bytes.length) navigate(next);
        else if (top < node.scrollTop || top + geometry.row > node.scrollTop + node.clientHeight) {
          node.scrollTop = Math.max(0, top - node.clientHeight / 3);
          setGeometry((current) => ({ ...current, top: node.scrollTop }));
        }
      }}
    >
      <div className="hex-lines" style={{ height: Math.max(1, count) * geometry.row }}>
        <div ref={probe} className="hex-probe" aria-hidden="true">
          00
        </div>
        {Array.from({ length: Math.max(0, last - first) }, (_, index) => {
          const row = first + index,
            offset = view.offset + row * 16,
            bytes = view.bytes.subarray(row * 16, row * 16 + 16),
            formatted = formatHexRow(offset, bytes);
          return (
            <div
              className="hex-row"
              key={offset}
              data-hex-row={offset}
              style={{ top: row * geometry.row, height: geometry.row }}
            >
              <span className="hex-address">{formatted.offset}</span>
              <span className="hex-bytes">
                {Array.from(bytes, (byte, index) => (
                  <button
                    type="button"
                    // biome-ignore lint/suspicious/noArrayIndexKey: The physical byte offset is its stable identity.
                    key={offset + index}
                    tabIndex={-1}
                    data-hex-byte={offset + index}
                    aria-label={`0x${(offset + index).toString(16).toUpperCase()}: ${hexByte(byte)}`}
                    aria-pressed={offset + index >= start && offset + index <= end}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      select(offset + index, event.shiftKey);
                      body.current?.focus();
                    }}
                    onPointerEnter={(event) => {
                      if (event.buttons === 1) select(offset + index, true);
                    }}
                    onClick={(event) => {
                      if (event.detail === 0) select(offset + index, event.shiftKey);
                      body.current?.focus();
                    }}
                  >
                    {hexByte(byte)}
                  </button>
                ))}
              </span>
              <span data-hex-ascii>
                {Array.from(formatted.ascii, (char, index) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: The physical byte offset is its stable identity.
                    key={offset + index}
                    data-selected={(offset + index >= start && offset + index <= end) || undefined}
                  >
                    {char}
                  </span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
