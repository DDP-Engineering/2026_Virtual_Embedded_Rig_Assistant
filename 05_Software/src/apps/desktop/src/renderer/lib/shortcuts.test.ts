// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { bindingFromEvent, shortcutCommand } from "./shortcuts.js";

afterEach(() => {
  document.body.innerHTML = "";
});
const key = (options: KeyboardEventInit) =>
  new KeyboardEvent("keydown", { ctrlKey: true, key: "n", ...options });
test("exact modifiers, aliases and empty overrides dispatch only configured commands", () => {
  expect(shortcutCommand(key({}))).toBe("newSession");
  expect(shortcutCommand(key({ shiftKey: true }))).toBeUndefined();
  expect(shortcutCommand(key({ key: "O", shiftKey: true }))).toBe("newSession");
  expect(shortcutCommand(key({}), { newSession: [] })).toBeUndefined();
  expect(shortcutCommand(key({ key: "p", shiftKey: true }), { settings: ["Mod+Shift+P"] })).toBe("settings");
  expect(bindingFromEvent(key({ key: "p", altKey: true, shiftKey: true }))).toBe("Mod+Alt+Shift+P");
});
test("dialogs, capture, composition, repeats, handled and AltGr events cannot dispatch", () => {
  expect(shortcutCommand(key({ repeat: true }))).toBeUndefined();
  expect(shortcutCommand(key({ isComposing: true }))).toBeUndefined();
  const handled = key({ cancelable: true });
  handled.preventDefault();
  expect(shortcutCommand(handled)).toBeUndefined();
  const event = key({});
  Object.defineProperty(event, "getModifierState", { value: () => true });
  expect(shortcutCommand(event)).toBeUndefined();
  document.body.innerHTML = "<dialog open></dialog>";
  expect(shortcutCommand(key({}))).toBeUndefined();
  document.body.innerHTML = "<input data-shortcut-capture>";
  const input = document.querySelector("input");
  if (!input) throw Error("input");
  const captured = key({ bubbles: true });
  let action: unknown;
  window.addEventListener(
    "keydown",
    (event) => {
      action = shortcutCommand(event);
    },
    { once: true },
  );
  input.dispatchEvent(captured);
  expect(action).toBeUndefined();
});

test("shifted digits and punctuation normalize their physical base positions", () => {
  for (const [keyValue, code, binding] of [
    ["!", "Digit1", "Mod+Shift+1"],
    ["<", "Comma", "Mod+Shift+,"],
    ["?", "Slash", "Mod+Shift+/"],
  ] as const) {
    const event = key({ key: keyValue, code, shiftKey: true });
    expect(bindingFromEvent(event)).toBe(binding);
    expect(bindingFromEvent(key({ key: keyValue, shiftKey: true }))).toBe(binding);
    expect(shortcutCommand(event, { newWorkbench: [binding] })).toBe("newWorkbench");
  }
});
