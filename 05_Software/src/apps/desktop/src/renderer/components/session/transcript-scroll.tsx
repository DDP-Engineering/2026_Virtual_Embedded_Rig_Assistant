// REQ-UX-1676bc64
import { type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** Controls the native transcript viewport; content, wheel and touch keep their usual ownership. */
export function TranscriptScroll({
  viewport,
  content,
  controls,
}: {
  viewport: RefObject<HTMLDivElement | null>;
  content: RefObject<HTMLDivElement | null>;
  controls: string;
}) {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState({ top: 0, maximum: 0, height: 0 });
  const drag = useRef<{ y: number; top: number } | null>(null);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const measure = () => {
      const next = {
        top: node.scrollTop,
        maximum: Math.max(0, node.scrollHeight - node.clientHeight),
        height: node.clientHeight,
      };
      setMetrics((previous) =>
        previous.top === next.top && previous.maximum === next.maximum && previous.height === next.height
          ? previous
          : next,
      );
    };
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(node);
    if (content.current) observer?.observe(content.current);
    return () => {
      observer?.disconnect();
      node.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [viewport, content]);
  const thumbHeight = Math.min(
    metrics.height,
    Math.max(24, metrics.height ** 2 / (metrics.maximum + metrics.height || 1)),
  );
  const travel = metrics.height - thumbHeight;
  const percent = metrics.maximum ? Math.round((metrics.top / metrics.maximum) * 100) : 0;
  return (
    <div
      className="transcript-scroll-rail"
      role="scrollbar"
      aria-label={t("chat.scrollConversation")}
      aria-controls={controls}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      hidden={metrics.maximum <= 1}
      tabIndex={0}
      onKeyDown={(event) => {
        const node = viewport.current;
        if (!node || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
        const positions: Record<string, number> = {
          ArrowUp: node.scrollTop - 40,
          ArrowDown: node.scrollTop + 40,
          PageUp: node.scrollTop - node.clientHeight * 0.9,
          PageDown: node.scrollTop + node.clientHeight * 0.9,
          Home: 0,
          End: metrics.maximum,
        };
        const position = positions[event.key];
        if (position === undefined) return;
        event.preventDefault();
        node.scrollTop = position;
      }}
      onPointerDown={(event) => {
        const node = viewport.current;
        if (!node || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        if (!(event.target as HTMLElement).closest("[data-scroll-thumb]")) {
          const offset = event.clientY - event.currentTarget.getBoundingClientRect().top - thumbHeight / 2;
          node.scrollTop = travel > 0 ? (offset / travel) * metrics.maximum : 0;
        }
        drag.current = { y: event.clientY, top: node.scrollTop };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const node = viewport.current;
        if (!drag.current || !node || travel <= 0) return;
        node.scrollTop = drag.current.top + ((event.clientY - drag.current.y) / travel) * metrics.maximum;
      }}
      onWheel={(event) => {
        const node = viewport.current;
        if (node && !event.ctrlKey)
          node.scrollTop +=
            event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onPointerUp={(event) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    >
      <span
        data-scroll-thumb
        aria-hidden="true"
        style={{ height: thumbHeight, top: metrics.maximum ? (metrics.top / metrics.maximum) * travel : 0 }}
      />
    </div>
  );
}
