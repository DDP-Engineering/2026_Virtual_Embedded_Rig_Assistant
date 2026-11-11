// REQ-UX-b2f6ffa8 REQ-UX-a3be2b11 REQ-UX-7b49305a REQ-FUNC-1219a1e4 REQ-UX-2bbfd052
/** Pointer target of one marker or group, in CSS pixels. */
export const MARKER_SIZE = 24;
const HALF = MARKER_SIZE / 2;
const PREVIEW_LENGTH = 140;
export type MarkerGroup = { center: number; members: number[] };
const finite = (value: number) => (Number.isFinite(value) ? value : 0);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, finite(value)));
/** Plain text with white space collapsed, cut at 140 code points; never interpreted as Markdown or HTML. */
export function previewText(text: string): string {
  // A bounded head keeps long pasted logs cheap; 4096 code units cover 140 normalized code points.
  const points = Array.from(text.slice(0, 4096).replace(/\s+/gu, " ").trim());
  return points.length > PREVIEW_LENGTH ? `${points.slice(0, PREVIEW_LENGTH).join("")}…` : points.join("");
}
/** Start of an element inside the scrolled content: rectangles plus scrollTop, not offsetTop's offset parent. */
export function contentOffset(viewport: HTMLElement): (element: Element) => number {
  const origin = viewport.getBoundingClientRect().top + viewport.clientTop - viewport.scrollTop;
  return (element) => element.getBoundingClientRect().top - origin;
}
/** Lane centre for a message starting at `y` of `scrollHeight`; the lane maps the whole content, not S - V. */
export function markerCenter(y: number, scrollHeight: number, lane: number): number {
  return HALF + clamp(y / Math.max(scrollHeight, 1), 0, 1) * Math.max(0, lane - MARKER_SIZE);
}
/** scrollTop that puts a message 16 px below the top, within the native range. */
export function scrollTarget(y: number, scrollHeight: number, viewport: number): number {
  return clamp(y - 16, 0, Math.max(0, scrollHeight - viewport));
}
/** Last message starting at or above the reading line, else the first; -1 without messages. */
export function currentIndex(starts: readonly number[], scrollTop: number, viewport: number): number {
  if (!starts.length) return -1;
  const line = finite(scrollTop) + Math.min(80, Math.max(0, finite(viewport)) / 4);
  let low = 0;
  let high = starts.length - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((starts[middle] ?? 0) <= line) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}
/**
 * Merges neighbouring markers whose targets would intersect, in order, until none do. A merged
 * centre is the mean of its members, so it only moves towards the group below, which is rechecked.
 */
export function groupMarkers(centers: readonly number[], lane: number): MarkerGroup[] {
  if (!centers.length) return [];
  const low = Math.min(HALF, lane / 2);
  const high = Math.max(lane - HALF, lane / 2);
  const points = centers.map((center) => clamp(center, low, high));
  if (lane < MARKER_SIZE)
    return [
      {
        center: clamp(points.reduce((sum, value) => sum + value, 0) / points.length, low, high),
        members: points.map((_, index) => index),
      },
    ];
  const stack: { sum: number; members: number[]; center: number }[] = [];
  points.forEach((center, index) => {
    stack.push({ sum: center, members: [index], center });
    while (stack.length > 1) {
      const top = stack[stack.length - 1];
      const below = stack[stack.length - 2];
      if (!top || !below || top.center - below.center >= MARKER_SIZE) break;
      stack.pop();
      below.sum += top.sum;
      below.members.push(...top.members);
      below.center = below.sum / below.members.length;
    }
  });
  return stack.map(({ center, members }) => ({ center, members }));
}
