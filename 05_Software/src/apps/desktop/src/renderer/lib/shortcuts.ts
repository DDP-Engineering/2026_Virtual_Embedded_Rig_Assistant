/** Global actions yield to modal input, IME composition and already-handled keys. */
export function globalShortcutBlocked(event: KeyboardEvent): boolean {
  return (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.altKey ||
    event.shiftKey ||
    !!document.querySelector("dialog[open]")
  );
}
