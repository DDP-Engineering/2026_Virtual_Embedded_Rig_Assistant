import { expect, test } from "vitest";
import { resolveLanguage } from "./language.js";
import { defaultLayout, layoutKey, readLayout, saveLayout } from "./layout.js";

test("system language resolves native regional locales and safely falls back to English", () => {
  expect(resolveLanguage("system", "ro-RO")).toBe("ro");
  expect(resolveLanguage("system", "DE_de")).toBe("de");
  expect(resolveLanguage("system", "fr-FR")).toBe("en");
  expect(resolveLanguage("en", "ro-RO")).toBe("en");
  expect(resolveLanguage("ro", "de-DE")).toBe("ro");
});

test("layout storage validates geometry, uses defaults for other formats and tolerates denied storage", () => {
  let raw: string | null = null;
  const storage = {
    getItem: (key: string) => {
      expect(key).toBe(layoutKey);
      return raw;
    },
    setItem: (key: string, value: string) => {
      expect(key).toBe(layoutKey);
      raw = value;
    },
  };
  expect(readLayout(storage)).toEqual(defaultLayout);
  const resized = { ...defaultLayout, sidebar: 19.5, right: 25, rightCollapsed: false };
  saveLayout(storage, resized);
  expect(readLayout(storage)).toEqual(resized);
  raw = JSON.stringify({ ...resized, sidebar: 300 });
  expect(readLayout(storage)).toEqual(defaultLayout);
  raw = JSON.stringify({ ...resized, extra: true });
  expect(readLayout(storage)).toEqual(defaultLayout);
  // Version 1 is the only layout format during development (AGENTS.md).
  raw = JSON.stringify({ ...resized, version: 2 });
  expect(readLayout(storage)).toEqual(defaultLayout);
  raw = "{";
  expect(readLayout(storage)).toEqual(defaultLayout);
  const denied = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  expect(readLayout(denied)).toEqual(defaultLayout);
  expect(() => saveLayout(denied, resized)).not.toThrow();
});

// REQ-UX-b3231a55
test("layout storage keeps a separate Source width that a stored layout must hold", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  expect(defaultLayout.source).toBe(36);
  saveLayout(storage, { ...defaultLayout, source: 64 });
  expect(readLayout(storage).source).toBe(64);
  const { source: _source, ...without } = defaultLayout;
  values.set(layoutKey, JSON.stringify({ ...without, right: 25 }));
  expect(readLayout(storage)).toEqual(defaultLayout);
  values.set(layoutKey, JSON.stringify({ ...defaultLayout, source: 95 }));
  expect(readLayout(storage)).toEqual(defaultLayout);
});
