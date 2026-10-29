import {
  commandBindings,
  type ShortcutCommand,
  type ShortcutOverrides,
  shortcutCommands,
} from "@vera/shared";
import { createContext } from "react";
export const ShortcutContext = createContext<ShortcutOverrides | undefined>(undefined);

/** Local dialogs, recording controls, IME and handled/repeated events retain ownership. */
export function globalShortcutBlocked(event: KeyboardEvent, allowModifiers = false): boolean {
  return (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.getModifierState("AltGraph") ||
    (!allowModifiers && (event.altKey || event.shiftKey)) ||
    !!document.querySelector("dialog[open]") ||
    (event.target instanceof Element && !!event.target.closest("[data-shortcut-capture]"))
  );
}
export function bindingFromEvent(event: KeyboardEvent): string | undefined {
  if (
    (!event.ctrlKey && !event.metaKey) ||
    (event.ctrlKey && event.metaKey) ||
    event.isComposing ||
    event.getModifierState("AltGraph")
  )
    return;
  // Digits and comma/slash use their physical base positions, including shifted symbols.
  // Letters follow event.key so a layout's letter names stay meaningful.
  let key = event.key;
  // Some Windows-injected events omit code; use the standard shifted symbol's base.
  const shifted: Record<string, string> = {
    "!": "1",
    "@": "2",
    "#": "3",
    $: "4",
    "%": "5",
    "^": "6",
    "&": "7",
    "*": "8",
    "(": "9",
    ")": "0",
    "<": ",",
    "?": "/",
  };
  if (!event.code && event.shiftKey) key = shifted[key] ?? key;
  if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(-1);
  else if (event.code === "Comma") key = ",";
  else if (event.code === "Slash") key = "/";
  if (!/^[a-z0-9,/]$/i.test(key)) return;
  return `Mod+${event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}${key.toUpperCase()}`;
}
export function shortcutCommand(
  event: KeyboardEvent,
  bindings?: ShortcutOverrides,
): ShortcutCommand | undefined {
  if (globalShortcutBlocked(event, true)) return;
  const binding = bindingFromEvent(event);
  return binding
    ? shortcutCommands.find((command) => commandBindings(command, bindings).includes(binding))
    : undefined;
}
export function displayBinding(binding: string): string {
  return binding.replace("Mod", "Ctrl");
}
