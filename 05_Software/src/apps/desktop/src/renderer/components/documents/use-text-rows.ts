import { useLayoutEffect, useMemo, useRef, useState } from "react";

const FALLBACK_LINE = 20;
const OVERSCAN = 40;
type Target = { line: number; align: "top" | "third" };

/** Finds a source row in the measured/estimated prefix offsets. */
function rowAt(offsets: readonly number[], top: number): number {
  let low = 0;
  let high = Math.max(0, offsets.length - 2);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((offsets[middle] ?? 0) <= top) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Measures only mounted rows and settles navigation after their actual heights are known. */
export function useTextRows(
  lines: readonly string[],
  wrap: boolean,
  initial: Target,
  onLine?: ((line: number) => void) | undefined,
) {
  const body = useRef<HTMLElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0, width: 0, line: FALLBACK_LINE });
  const currentViewport = useRef(viewport);
  currentViewport.current = viewport;
  const [sizes, setSizes] = useState<ReadonlyMap<number, number>>(new Map());
  const pending = useRef<Target | undefined>(initial);
  const report = useRef(onLine);
  report.current = onLine;
  const offsets = useMemo(() => {
    const next = [0];
    for (let i = 0; i < lines.length; i++)
      next.push((next[i] ?? 0) + (wrap ? (sizes.get(i) ?? viewport.line) : viewport.line));
    return next;
  }, [lines, sizes, viewport.line, wrap]);
  const previous = useRef(offsets);
  const latest = useRef(offsets);
  latest.current = offsets;
  const scrollTo = (line: number, align: Target["align"] = "third") => {
    const node = body.current;
    if (!node || !lines.length) return;
    const target = Math.max(1, Math.min(lines.length, line));
    pending.current = { line: target, align };
    node.scrollTop = Math.max(0, (offsets[target - 1] ?? 0) - (align === "top" ? 0 : node.clientHeight / 3));
    setViewport((value) => ({ ...value, top: node.scrollTop }));
  };
  useLayoutEffect(() => {
    const node = body.current;
    if (!node) return;
    const sync = () => {
      setViewport((value) => ({ ...value, top: node.scrollTop, height: node.clientHeight }));
      if (latest.current.length > 1) report.current?.(rowAt(latest.current, node.scrollTop) + 1);
    };
    const resize = () => {
      const line = probe.current?.getBoundingClientRect().height || FALLBACK_LINE;
      const value = currentViewport.current;
      if (value.width !== node.clientWidth || value.line !== line) setSizes(new Map());
      setViewport({ top: node.scrollTop, height: node.clientHeight, width: node.clientWidth, line });
    };
    resize();
    node.addEventListener("scroll", sync, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
    observer?.observe(node);
    if (probe.current) observer?.observe(probe.current);
    return () => {
      node.removeEventListener("scroll", sync);
      observer?.disconnect();
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new decoded source or wrap mode explicitly invalidates cached measurements.
  useLayoutEffect(() => {
    const node = body.current;
    if (node && !pending.current)
      pending.current = { line: rowAt(previous.current, currentViewport.current.top) + 1, align: "top" };
    setSizes(new Map());
  }, [lines, wrap]);
  useLayoutEffect(() => {
    const node = body.current;
    if (!node || !lines.length) return;
    const old = previous.current;
    previous.current = offsets;
    if (old !== offsets && !pending.current) {
      // The browser can clamp scrollTop as soon as a shorter spacer commits. Use the old viewport.
      const anchor = rowAt(old, viewport.top);
      node.scrollTop = Math.max(0, (offsets[anchor] ?? 0) + viewport.top - (old[anchor] ?? 0));
    }
    const next = new Map(sizes);
    let changed = false;
    if (wrap)
      for (const row of node.querySelectorAll<HTMLElement>("[data-line]")) {
        const index = Number(row.dataset.line) - 1;
        const height = row.getBoundingClientRect().height;
        if (height > 0 && next.get(index) !== height) {
          next.set(index, height);
          changed = true;
        }
      }
    if (changed) setSizes(next);
    const target = pending.current;
    if (target) {
      const index = Math.max(0, Math.min(lines.length - 1, target.line - 1));
      node.scrollTop = Math.max(
        0,
        (offsets[index] ?? 0) - (target.align === "top" ? 0 : node.clientHeight / 3),
      );
      if (!changed && (!wrap || sizes.has(index))) pending.current = undefined;
    }
    if (viewport.top !== node.scrollTop) setViewport((value) => ({ ...value, top: node.scrollTop }));
  });
  const first = Math.max(0, rowAt(offsets, viewport.top) - OVERSCAN);
  const last = Math.min(
    lines.length - 1,
    rowAt(offsets, viewport.top + (viewport.height || viewport.line * 20)) + OVERSCAN,
  );
  const visible = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => i + first + 1);
  return { body, probe, offsets, visible, scrollTo };
}
