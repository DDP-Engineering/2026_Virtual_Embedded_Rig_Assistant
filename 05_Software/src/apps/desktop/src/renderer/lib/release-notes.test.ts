import { expect, it } from "vitest";
import { releasesFor } from "./release-notes.js";

const note = (category: string, en: string, fr?: string) => ({
  category,
  topic: { en: "Plugins", ...(fr ? { fr: "Plugins" } : {}) },
  text: { en, ...(fr ? { fr } : {}) },
});

it("orders Unreleased and releases newest first, groups by category and picks the language", () => {
  const releases = releasesFor(
    [
      { version: "0.1.0", date: "2026-11-15", entries: [note("fixed", "Old fix")] },
      { version: "Unreleased", date: null, entries: [note("fixed", "Fix", "Correctif"), note("new", "New")] },
      { version: "0.2.0", date: "2026-12-01", entries: [note("improved", "Better")] },
      { version: "0.2.0-beta.1", date: "2026-11-20", entries: [note("new", "Beta")] },
    ],
    "fr",
  );
  expect(releases.map((release) => release.version)).toEqual([
    "Unreleased",
    "0.2.0",
    "0.2.0-beta.1",
    "0.1.0",
  ]);
  expect(releases[0]?.groups).toEqual([
    { category: "new", items: [{ topic: "Plugins", text: "New" }] },
    { category: "fixed", items: [{ topic: "Plugins", text: "Correctif" }] },
  ]);
});

it("leaves out malformed files and releases without entries", () => {
  expect(
    releasesFor(
      [
        { version: "Unreleased", date: null, entries: [] },
        { version: "0.1.0", date: "2026-11-15", entries: [note("other", "Wrong category")] },
        "not a mapping",
      ],
      "en",
    ),
  ).toEqual([]);
});
