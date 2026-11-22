import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { SettingsService } from "@vera/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserRelease } from "../../src/apps/desktop/src/main/browser/release.js";
import { BrowserRuntime } from "../../src/apps/desktop/src/main/browser/runtime.js";
import { dictationCatalog } from "../../src/apps/desktop/src/main/dictation/catalog.js";
import { DictationModels } from "../../src/apps/desktop/src/main/dictation/models.js";
import { createFileAccess } from "../../src/apps/desktop/src/main/file-access.js";
import { systemClock } from "../../src/apps/desktop/src/main/host-ports.js";

// Native proof of offline installation: set VERA_COMPONENTS_DIR to the `components/` folder of a delivery
// (npm run delivery:components). The real pinned files install with a transfer that fails if called, under the
// test network guard.
const components = process.env.VERA_COMPONENTS_DIR;
const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const offline = () =>
  vi.fn<typeof fetch>(async () => {
    throw new Error("network used");
  });

describe.skipIf(!components)("offline components from a delivery", () => {
  // REQ-FUNC-75aa4017
  it("installs this platform's pinned browser runtime from its delivery archive", {
    timeout: 600_000,
  }, async () => {
    const release = browserRelease();
    if (!release) throw new Error("unsupported platform");
    const root = await mkdtemp(join(tmpdir(), "vera-offline-browser-"));
    scratch.push(root);
    const transfer = offline();
    const runtime = new BrowserRuntime(root, { transfer });
    const file = join(components ?? "", basename(new URL(release.url).pathname));
    await expect(runtime.provision({ file })).resolves.toEqual({ phase: "ready", version: release.version });
    expect(await runtime.executable()).toBe(join(root, release.version, release.executable));
    expect(await readdir(root)).toEqual([release.version]);
    expect(transfer).not.toHaveBeenCalled();
  });

  // REQ-FUNC-17812cd0
  it("installs both pinned Whisper models from their delivery archives", { timeout: 600_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "vera-offline-dictation-"));
    scratch.push(dir);
    const settings = new SettingsService({
      paths: { userData: dir, settings: join(dir, "settings.json"), logs: join(dir, "logs") },
      uuid: randomUUID,
      changed: vi.fn(),
      files: createFileAccess(systemClock),
    });
    const transfer = offline();
    const models = new DictationModels(dir, settings, { transfer });
    for (const { id } of dictationCatalog) {
      await models.installArchive(id, join(components ?? "", `${id}.zip`));
      await vi.waitFor(
        async () =>
          expect((await models.get()).models.find((model) => model.id === id)?.status).toBe("installed"),
        { timeout: 300_000, interval: 250 },
      );
      await models.change({ action: "select", id });
      expect(await models.resolveSelected()).toMatchObject({
        id,
        directory: join(dir, "dictation-models", id),
      });
    }
    expect(transfer).not.toHaveBeenCalled();
    await models.close();
  });
});
