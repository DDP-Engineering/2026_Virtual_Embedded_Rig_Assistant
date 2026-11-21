import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Node ESM evaluator modules; their behavior is what these tests check.
const scoring = await import(pathToFileURL(join(root, "evaluators/grounding/scoring.mjs")).href);
const { spec } = await import(pathToFileURL(join(root, "evaluators/grounding/run.mjs")).href);
const { loadCases } = await import(pathToFileURL(join(root, "evaluators/shared/cases.mjs")).href);

describe("grounding scoring", () => {
  it("extracts technical values in a canonical form, ignoring citation refs", () => {
    expect(
      scoring.extractValues(
        "0x0048 on PA9/PA10 at 115200 baud, 3,3 V, 16 MHz, 500 ms, 4.7 kΩ [[docs/a.pdf#p=2]]",
      ),
    ).toEqual(["0x48", "pa9", "pa10", "115200baud", "3.3v", "16mhz", "500ms", "4.7kohm"]);
    expect(scoring.extractValues("The sensors respond; 3 sensors and bit 10.")).toEqual([]);
  });

  it("flags values the model did not see, as true and false positives", () => {
    const evidence = ["Supply 3.3 V (3.15 V to 3.45 V). Address 0x48."];
    expect(scoring.ungroundedValues("It runs at 3.30 V from address 0x0048.", evidence)).toEqual([]);
    expect(scoring.ungroundedValues("The SPI clock is 8 MHz on PA4.", evidence)).toEqual(["8mhz", "pa4"]);
    expect(scoring.ungroundedValues("The documents do not specify it.", evidence)).toEqual([]);
  });

  it("recognizes abstention in English and Romanian, and not a plain answer", () => {
    expect(scoring.abstains("The datasheet does not specify an SPI clock frequency.")).toBe(true);
    expect(scoring.abstains("I couldn't find a buzzer pin in the workbench documents.")).toBe(true);
    expect(scoring.abstains("Documentele nu conțin frecvența ceasului SPI.")).toBe(true);
    expect(scoring.abstains("Nu am găsit nicio informație despre EEPROM.")).toBe(true);
    expect(scoring.abstains("The SPI clock runs at 8 MHz.")).toBe(false);
  });

  it("detects the answer language, ignoring quoted English text", () => {
    expect(scoring.languageOf("Senzorul extern folosește adresa 0x48, conform foii de date.")).toBe("ro");
    expect(scoring.languageOf("The external sensor uses address 0x48.")).toBe("en");
    expect(scoring.languageOf('> "The external sensor uses address 0x48."\nAdresa este 0x48.')).toBe("ro");
    expect(scoring.englishQuery("external sensor I2C address")).toBe(true);
    expect(scoring.englishQuery("adresa senzorului extern")).toBe(false);
  });

  it("matches citation targets by path and page range", () => {
    const targets = [{ path: "docs/d.pdf", page: 2 }, { path: "sources/d.md" }];
    expect(scoring.onTarget("docs/d.pdf#p=2", targets)).toBe(true);
    expect(scoring.onTarget("docs/d.pdf#p=1-2", targets)).toBe(true);
    expect(scoring.onTarget("docs/d.pdf#p=1", targets)).toBe(false);
    expect(scoring.onTarget("sources/d.md#L3-L5", targets)).toBe(true);
    expect(scoring.onTarget("docs/other.pdf#p=2", targets)).toBe(false);
  });

  it("normalizes answers before the expected patterns", () => {
    expect(
      scoring.matchesAll("Range: 0 °C – 70 °C", [String.raw`\b0\s*(?:°\s*c)?\s*(?:to|-)\s*\+?70\b`]),
    ).toBe(true);
    expect(scoring.matchesAll("3,15 V to 3,45 V", ["3[.]15", "3[.]45"])).toBe(true);
    expect(scoring.matchesAll("3.15 V", ["3[.]15", "3[.]45"])).toBe(false);
  });
});

describe("grounding cases", () => {
  it("are valid, pair every answerable question in two languages and include unanswerable ones", async () => {
    const file = await loadCases(spec.casesFile, spec.expect);
    const known = file.cases.filter((c: { expect: { answerable: boolean } }) => c.expect.answerable);
    const unknown = file.cases.filter((c: { expect: { answerable: boolean } }) => !c.expect.answerable);
    expect(known).toHaveLength(28);
    expect(unknown.length).toBeGreaterThanOrEqual(10);
    const ids = new Set(known.map((c: { id: string }) => c.id));
    for (const id of ids)
      if (String(id).endsWith("-en")) expect(ids.has(String(id).replace(/-en$/, "-ro"))).toBe(true);
  });
});
