// REQ-UX-58a693f3
import type { Settings } from "@vera/shared";
import { useSyncExternalStore } from "react";

/** Appearance values shown before they are saved; undefined when nothing is previewed. */
export type AppearancePreview = Partial<
  Pick<Settings, "language" | "theme" | "textScale" | "chatFontSize" | "codeFontSize">
>;

let current: AppearancePreview | undefined;
const listeners = new Set<() => void>();

/** Shows draft Appearance values at once; undefined restores the saved ones. */
export function setAppearancePreview(next: AppearancePreview | undefined): void {
  const value = next && Object.keys(next).length ? next : undefined;
  if (JSON.stringify(value) === JSON.stringify(current)) return;
  current = value;
  for (const listener of listeners) listener();
}

export function useAppearancePreview(): AppearancePreview | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
