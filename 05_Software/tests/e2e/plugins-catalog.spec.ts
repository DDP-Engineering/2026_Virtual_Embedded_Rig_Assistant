// REQ-FUNC-f244f8f6 REQ-UX-c55a0fe1 REQ-UX-9207423e REQ-FUNC-46079512: installing and updating from a
// tagged catalog release in native Electron, served by a loopback catalog host.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test } from "@playwright/test";
import { zipSync } from "fflate";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "../../src/apps/desktop");
const official = join(here, "../../plugins/serial-monitor");

async function files(folder: string): Promise<Record<string, Uint8Array>> {
  const result: Record<string, Uint8Array> = {};
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true }))
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      result[`serial-monitor/${relative(folder, path).replaceAll("\\", "/")}`] = await readFile(path);
    }
  return result;
}
/** A tagged release of serial-monitor: its zip and index.json, with the manifest changed by `edit`. */
async function release(out: string, version: string, edit: (manifest: string) => string = (text) => text) {
  const entries = await files(official);
  const manifest = new TextDecoder().decode(entries["serial-monitor/plugin.yaml"]);
  entries["serial-monitor/plugin.yaml"] = new TextEncoder().encode(
    edit(manifest.replace(/^version: .*$/m, `version: ${version}`)),
  );
  const zip = zipSync(entries);
  await mkdir(out, { recursive: true });
  const url = `serial-monitor-${version}.zip`;
  await writeFile(join(out, url), zip);
  const index = {
    format: 1,
    plugins: [
      {
        id: "serial-monitor",
        version,
        tier: "official",
        ecosystem: "general",
        platforms: ["windows-x64", "linux-x64"],
        name: "Serial monitor",
        description: "Lists serial ports and captures consoles.",
        requires: [],
        url,
        sha256: createHash("sha256").update(zip).digest("hex"),
        bytes: zip.length,
      },
    ],
    packs: [
      {
        id: "esp32",
        name: "ESP32 (Espressif)",
        groups: [{ name: "Core", plugins: ["serial-monitor"], default: true }],
      },
    ],
  };
  await writeFile(join(out, "index.json"), JSON.stringify(index));
}

test("installs a plugin from a tagged catalog release and reviews an update that changes a rule", async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(join(tmpdir(), "vera-plugins-catalog-"));
  const state = { folder: join(root, "v1.0.0") };
  await release(state.folder, "1.0.0");
  const server = createServer(async (request, response) => {
    try {
      const body = await readFile(join(state.folder, (request.url ?? "/").split("/").at(-1) ?? ""));
      response.writeHead(200, { "content-length": body.length }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const catalogUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/vera/`;
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  // No bundled catalog: the page shows only what the loopback catalog serves.
  env.VERA_TEST_BUNDLED_PLUGINS = "";
  const app = await _electron.launch({
    executablePath: join(
      desktop,
      "../../../node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    chromiumSandbox: true,
    args: [desktop, `--user-data-dir=${join(root, "data")}`],
    env,
  });
  await installNetworkGuard(app);
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.locator('[data-action="plugins-nav"]').click();
    const catalog = page.locator("[data-plugin-catalog]");
    await expect(catalog.locator('[data-catalog-source="none"]')).toBeVisible();
    await catalog.locator(".plugin-catalog-settings > summary").click();
    await catalog.locator("[data-catalog-url]").fill(catalogUrl);
    await catalog.locator('[data-action="catalog-url-save"]').click();
    await expect(catalog.locator('[data-catalog-source="remote"]')).toContainText(catalogUrl);
    const item = page.locator('[data-catalog-plugin="serial-monitor"]');
    await expect(item).toContainText("1.0.0");
    await expect(item.locator('[data-tier="official"]')).toHaveText("Official");

    // First install: the verified zip opens the review screen; Install records the official tier.
    await item.locator('[data-action="catalog-install"]').click();
    const review = page.locator("[data-plugin-review]");
    await expect(review.locator("[data-catalog-review]")).toContainText(
      "From the catalog: Official, version 1.0.0.",
    );
    await expect(review.locator('[data-program="serial"]')).toContainText("scripts/serial_monitor.py");
    await review.locator('[data-action="plugin-install"]').click();
    await page.locator('[data-library-tab="installed"]').click();
    const card = page.locator('[data-plugin="serial-monitor"]');
    await expect(card).toContainText("Official");
    await expect(card).toContainText("1.0.0");
    const record = JSON.parse(
      await readFile(join(root, "data/plugins/installed/serial-monitor/install.json"), "utf8"),
    );
    expect(record).toMatchObject({
      tier: "official",
      source: { kind: "catalog", path: `${catalogUrl}serial-monitor-1.0.0.zip` },
    });

    // The catalog publishes 1.0.1, which rates `serial list` higher: the update shows the review screen.
    state.folder = join(root, "v1.0.1");
    await release(state.folder, "1.0.1", (text) =>
      text.replace('{ match: "serial list *", risk: safe }', '{ match: "serial list *", risk: device-read }'),
    );
    await catalog.locator('[data-action="catalog-check"]').click();
    await expect(card.locator("[data-plugin-update]")).toHaveText("Update available: 1.0.1");
    await card.locator('[data-action="plugin-update"]').click();
    await expect(review.locator("[data-catalog-review]")).toContainText(
      "This update changes programs, install sources or rules",
    );
    await expect(review).toContainText("Installing replaces the installed version 1.0.0.");
    await review.locator('[data-action="plugin-install"]').click();
    await expect(card).toContainText("1.0.1");
    await expect(card.locator("[data-plugin-update]")).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
