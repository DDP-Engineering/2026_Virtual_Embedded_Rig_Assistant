import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";

test("i18n audit rejects missing, unused and translation-only keys including dynamic contracts", async () => {
  const path = "scripts/check-i18n.mjs";
  expect(existsSync(path), "catalog audit is implemented").toBe(true);
  const { auditCatalogs } = await import(/* @vite-ignore */ pathToFileURL(`${process.cwd()}/${path}`).href);
  const en = { screen: { title: "Title", count: "{{count}} items" } };
  const source = 't("screen.title"); defineTranslationKeys(["screen.count"]);';
  expect(auditCatalogs({ en, ro: en, de: en }, [source])).toEqual([]);
  expect(auditCatalogs({ en, ro: en, de: en }, [`${source}t(arbitraryKey);`])).toContain(
    "unregistered dynamic translation call",
  );
  expect(auditCatalogs({ en, ro: en, de: en }, [`${source}t("screen.missing");`])).toContain(
    "missing source key: screen.missing",
  );
  expect(auditCatalogs({ en, ro: { screen: { title: "Titlu" } }, de: en }, [source])).toContain(
    "ro missing key: screen.count",
  );
  expect(auditCatalogs({ en, ro: en, de: en }, ['t("screen.title");'])).toContain(
    "unused source key: screen.count",
  );
  expect(auditCatalogs({ en, ro: en, de: { ...en, extra: "Only here" } }, [source])).toContain(
    "de translation-only key: extra",
  );
  // biome-ignore lint/suspicious/noTemplateCurlyInString: checker fixture contains literal source code.
  expect(auditCatalogs({ en, ro: en, de: en }, ["t(`screen.${field}`);"])).toContain(
    "unregistered dynamic translation call",
  );
});

test("catalog CLI fails with a missing-key fixture", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/check-i18n.mjs", "--fixture", "tests/fixtures/i18n/missing-key.json"],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("missing source key: screen.missing");
});
