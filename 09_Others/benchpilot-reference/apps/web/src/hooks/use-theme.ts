import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "bp-theme";
const listeners = new Set<() => void>();

function readTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function applyTheme(next: Theme) {
  document.documentElement.classList.toggle("dark", next === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage can be unavailable (private mode); the toggle still works for this tab.
  }
  listeners.forEach((l) => l());
}

/**
 * Light by default (05); the choice persists per browser. index.html applies it before first paint.
 * One store for the whole app, so the toaster and charts follow the top-bar toggle.
 */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme);
  const setTheme = useCallback((next: Theme) => applyTheme(next), []);
  const toggleTheme = useCallback(() => applyTheme(readTheme() === "dark" ? "light" : "dark"), []);
  return { theme, setTheme, toggleTheme };
}
