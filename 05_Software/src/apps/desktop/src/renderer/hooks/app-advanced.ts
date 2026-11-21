// REQ-UX-441b5a9d REQ-UX-a4cf0527 REQ-UX-996ae06e REQ-FUNC-7509bd1e
import { type AdvancedKey, type AdvancedValueOf, resolveAdvanced, type StoredAdvanced } from "@vera/shared";
import { useSyncExternalStore } from "react";

/**
 * The saved application Advanced values for components that also render without a query client (lists,
 * transcript, terminal tab). usePreferences sets it from the settings snapshot; before that, and in tests
 * that set nothing, every value is its registry default.
 */
let current: StoredAdvanced;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function setAppAdvanced(next: StoredAdvanced): void {
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  for (const listener of listeners) listener();
}

/** The resolved application value now, for a value read once (a terminal view as it opens). */
export function appAdvancedValue<K extends AdvancedKey>(key: K): AdvancedValueOf<K> {
  return resolveAdvanced(key, { app: current }).value;
}

/** The resolved application value; the component renders again when the saved value changes. */
export function useAppAdvanced<K extends AdvancedKey>(key: K): AdvancedValueOf<K> {
  const stored = useSyncExternalStore(subscribe, () => current);
  return resolveAdvanced(key, { app: stored }).value;
}
