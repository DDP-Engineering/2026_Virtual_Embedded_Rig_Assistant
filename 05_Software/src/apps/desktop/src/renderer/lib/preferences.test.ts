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

test("layout storage validates geometry, preserves future versions and tolerates denied storage", () => {
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
  expect(readLayout(storage)).toEqual({ layout: defaultLayout, readOnly: false });
  const resized = { ...defaultLayout, sidebar: 19.5, right: 25, rightCollapsed: false };
  saveLayout(storage, resized, false);
  expect(readLayout(storage)).toEqual({ layout: resized, readOnly: false });
  raw = JSON.stringify({ ...resized, sidebar: 300 });
  expect(readLayout(storage).layout).toEqual(defaultLayout);
  raw = JSON.stringify({ ...resized, extra: true });
  expect(readLayout(storage).layout).toEqual(defaultLayout);
  raw = '{ "version": 99, "future": "preserve" }';
  const before = raw;
  const future = readLayout(storage);
  expect(future.readOnly).toBe(true);
  saveLayout(storage, resized, future.readOnly);
  expect(raw).toBe(before);
  saveLayout(storage, resized, true);
  expect(raw).toBe(before);
  raw = "{";
  expect(readLayout(storage).layout).toEqual(defaultLayout);
  const denied = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  expect(readLayout(denied).layout).toEqual(defaultLayout);
  expect(() => saveLayout(denied, resized, false)).not.toThrow();
});

// REQ-UX-b3231a55
test("layout storage keeps a separate Source width and loads an older layout with its default", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  expect(defaultLayout.source).toBe(36);
  const { source: _source, ...older } = defaultLayout;
  values.set(layoutKey, JSON.stringify({ ...older, right: 25 }));
  expect(readLayout(storage).layout).toEqual({ ...defaultLayout, right: 25 });
  saveLayout(storage, { ...defaultLayout, source: 64 }, false);
  expect(readLayout(storage).layout.source).toBe(64);
  values.set(layoutKey, JSON.stringify({ ...defaultLayout, source: 95 }));
  expect(readLayout(storage).layout).toEqual(defaultLayout);
});
