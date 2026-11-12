// @vitest-environment jsdom
// REQ-UX-a7a3f2a9
import { CATALOG_ACTIVITIES } from "@vera/shared";
import { expect, it } from "vitest";
import i18n from "../i18n.js";
import { pluginActivityLabels } from "./plugin-library-controls.js";

it("labels every catalog activity, including design, in English, Romanian and German", () => {
  expect(CATALOG_ACTIVITIES).toContain("design");
  const design = { en: "Design", ro: "Proiectare", de: "Entwurf" } as const;
  for (const language of ["en", "ro", "de"] as const) {
    const labels = pluginActivityLabels(i18n.getFixedT(language));
    expect(Object.keys(labels).sort()).toEqual([...CATALOG_ACTIVITIES].sort());
    for (const activity of CATALOG_ACTIVITIES) {
      expect(labels[activity], `${language} ${activity}`).not.toMatch(/^plugins\.library\.activities\./);
      expect(labels[activity].trim().length, `${language} ${activity}`).toBeGreaterThan(0);
    }
    expect(labels.design).toBe(design[language]);
  }
});
