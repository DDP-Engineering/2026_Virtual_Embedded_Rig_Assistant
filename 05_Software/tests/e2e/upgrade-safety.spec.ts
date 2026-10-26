import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, type ElectronApplication, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import Database from "better-sqlite3";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const software = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const desktop = join(software, "src/apps/desktop");
async function launch(userData: string, folder: string) {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  env.VERA_TEST_DIALOG_PATH = folder;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: join(
      software,
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    chromiumSandbox: true,
    args: [desktop, `--user-data-dir=${userData}`],
    env,
  });
  expect(resolve(await app.evaluate(({ app }) => app.getPath("userData")))).toBe(resolve(userData));
  await installNetworkGuard(app);
  return app;
}
async function files(root: string): Promise<unknown[]> {
  const result: unknown[] = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push({ name: entry.name, children: await files(path) });
    else {
      const metadata = await stat(path);
      result.push({
        name: entry.name,
        sha256: createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
        bytes: metadata.size,
        mtime: metadata.mtimeMs,
        mode: metadata.mode,
      });
    }
  }
  return result;
}

test("newer settings expose defaults and visible read-only controls with unchanged original metadata/backups", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-wp32-settings-"));
  const original = join(root, "settings.json");
  let app: ElectronApplication | undefined;
  try {
    await writeFile(original, '{ "schemaVersion": 5, "theme": "future", "opaque": "keep exactly" }');
    await writeFile(`${original}.bak-3`, "existing previous backup");
    const before = await files(root);
    app = await launch(root, root);
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!(window as unknown as { vera: VeraBridge }).vera);
    expect(
      await page.evaluate(() =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.get", {}),
      ),
    ).toMatchObject({ readOnly: true, settings: { schemaVersion: 4, theme: "system" } });
    await page.locator('[data-i18n="nav.settings"]').click();
    await expect(page.locator('[data-i18n="settings.readOnly"]')).toBeVisible();
    for (const control of await page.locator("[data-theme-option], [data-scale], #language").all())
      await expect(control).toBeDisabled();
    expect(
      await page.evaluate(() =>
        (window as unknown as { vera: VeraBridge }).vera
          .invoke("app.settings.update", { theme: "dark" })
          .catch((error) => error),
      ),
    ).toEqual({ code: "DENIED", messageKey: "errors.DENIED" });
    await page.screenshot({ path: test.info().outputPath("newer-settings.png") });
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    app = undefined;
    const after = (await files(root)) as { name: string }[];
    expect(
      after.filter((entry) => entry.name === "settings.json" || entry.name.startsWith("settings.json.bak-")),
    ).toEqual(before);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

for (const kind of ["yaml", "database"] as const) {
  test(`newer ${kind} shows created-by-newer-VERA refusal and preserves YAML/DB/WAL/SHM/lock/backups`, async () => {
    const root = await mkdtemp(join(tmpdir(), "vera-wp32-newer-"));
    const bench = join(root, "Board é");
    await mkdir(join(bench, ".vera/backups"), { recursive: true });
    let app: ElectronApplication | undefined;
    let writer: Database.Database | undefined;
    try {
      await writeFile(
        join(bench, ".vera/workbench.yaml"),
        await readFile(
          join(software, `tests/fixtures/upgrade/workbench-${kind === "yaml" ? "newer" : "v1"}.yaml`),
        ),
      );
      await writeFile(join(bench, ".vera/WORKBENCH.md"), "Previous pinned context\n");
      await writeFile(join(bench, ".vera/lock"), '{"pid":99999999,"token":"preserve-foreign-lock"}');
      await writeFile(join(bench, ".vera/backups/vera.db.v1.bak"), "existing recovery backup");
      if (kind === "database") {
        writer = new Database(join(bench, ".vera/vera.db"));
        writer.pragma("journal_mode=WAL");
        writer.exec(
          "CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO meta VALUES('schema_version','99'),('workbench_id','future')",
        );
      }
      const before = await files(bench);
      app = await launch(join(root, "profile"), bench);
      const page = await app.firstWindow();
      await page.waitForFunction(() => !!(window as unknown as { vera: VeraBridge }).vera);
      await page.locator('[data-action="open-workbench"]').click();
      await expect(page.locator('[data-i18n="errors.WORKBENCH_TOO_NEW"]')).toHaveText(
        "This workbench was created by a newer VERA version.",
      );
      await expect(page.locator('[data-workbench="active"]')).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          (window as unknown as { vera: VeraBridge }).vera.invoke("workbench.recent", {}),
        ),
      ).toEqual([]);
      expect(await files(bench)).toEqual(before);
      await page.screenshot({ path: test.info().outputPath(`newer-${kind}.png`) });
      expect(await outboundAttempts(app)).toEqual([]);
      await app.close();
      app = undefined;
      expect(await files(bench)).toEqual(before);
    } finally {
      await app?.close();
      writer?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
