import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { parse } from "yaml";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../../src/apps/desktop");
const executable = join(
  desktop,
  "../../../node_modules/electron/dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);
async function launch(userData: string, folder: string) {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  env.VERA_TEST_DIALOG_PATH = folder;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: executable,
    chromiumSandbox: true,
    args: [desktop, `--user-data-dir=${userData}`],
    env,
  });
  await installNetworkGuard(app);
  return app;
}
test("Welcome creates, restarts, reopens recent, edits pinned and closes with validated IPC", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-wp06-"));
  const folder = join(root, "Banc ă");
  await mkdir(folder);
  let app = await launch(join(root, "data"), folder);
  try {
    let page = await app.firstWindow();
    await expect(page.locator('[data-action="open-demo"], [data-demo-guide]')).toHaveCount(0);
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator('[data-action="choose-create"]').click();
    await page.locator("#workbench-name").fill("VERA-DEMO-01");
    await page.locator('[data-action="create-workbench"]').click();
    await expect(page.locator('[data-workbench="active"]')).toContainText("VERA-DEMO-01");
    expect(existsSync(join(folder, ".vera/lock"))).toBe(true);
    expect(existsSync(join(folder, ".vera/vera.db"))).toBe(true);
    await page.locator('[data-action="edit-workbench-overview"]').focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".workbench-editor")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".workbench-editor")).toHaveCount(0);
    await expect(page.locator('[data-action="edit-workbench-overview"]')).toBeFocused();
    await page.locator('[data-action="edit-workbench-overview"]').click();
    await page.locator('[data-project-section="instructions"]').click();
    await expect(page.locator(".workbench-editor")).toBeVisible();
    await page.locator("#pinned-content").fill("# VERA-DEMO-01\nFictional board context");
    await page.locator("[data-project-save]").click();
    await expect(page.locator(".workbench-editor")).not.toBeVisible();
    expect(await readFile(join(folder, ".vera/WORKBENCH.md"), "utf8")).toContain("Fictional board context");
    const ipc = await page.evaluate(async () => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const config = await api.invoke("workbench.config.get", {});
      const events: unknown[] = [];
      const stop = api.subscribe("workbench", config.config.id, (e) => events.push(e));
      await api.invoke("workbench.config.update", { patch: { description: "Demo" } });
      await new Promise((resolve) => setTimeout(resolve, 50));
      stop();
      return {
        config: await api.invoke("workbench.config.get", {}),
        files: await api.invoke("workbench.files", { query: "WORKBENCH" }),
        events,
      };
    });
    expect(ipc.config.config.description).toBe("Demo");
    expect(ipc.files).not.toContain(".vera/WORKBENCH.md");
    expect(ipc.events).toContainEqual(expect.objectContaining({ type: "config.changed" }));
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    expect(existsSync(join(folder, ".vera/lock"))).toBe(false);
    app = await launch(join(root, "data"), folder);
    page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("[data-workbench-entry] .workbench-group-name").click();
    await expect(page.locator('[data-workbench="active"]')).toContainText("VERA-DEMO-01");
    await page.locator("[data-workbench-entry] .workbench-menu summary").first().click();
    await page.locator('[data-action="close-workbench"]').click();
    await expect(page.locator('[data-workbench="active"]')).toHaveCount(0);
    expect(existsSync(join(folder, ".vera/lock"))).toBe(false);
    await page.screenshot({ path: test.info().outputPath("welcome-recents.png") });
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("Welcome deleted recent is missing and can be removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-wp06-missing-"));
  const folder = join(root, "bench");
  await mkdir(folder);
  let app = await launch(join(root, "data"), folder);
  try {
    let page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator('[data-action="choose-create"]').click();
    await page.locator("#workbench-name").fill("Deleted board");
    await page.locator('[data-action="create-workbench"]').click();
    await expect(page.locator('[data-workbench="active"]')).toBeVisible();
    await app.close();
    await rm(folder, { recursive: true });
    app = await launch(join(root, "data"), folder);
    page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator('[data-i18n="nav.welcome"]').click();
    const missing = page.locator('[data-workbench-entry][data-missing="true"]');
    await expect(missing).toBeVisible();
    await expect(missing.locator(".workbench-group-name")).toBeDisabled();
    await page.screenshot({ path: test.info().outputPath("missing-recent.png") });
    await missing.locator(".workbench-menu > summary").click();
    await missing.getByRole("button", { name: "Remove from list", exact: true }).click();
    await expect(missing).toHaveCount(0);
    const settings = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.get", {}),
    );
    expect(settings.settings.recentWorkbenches).toEqual([]);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("Welcome opens copied demo with a live lock read-only and preserves owner bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-wp06-reader-"));
  const folder = join(root, "demo-board");
  await cp(join(desktop, "../../../tests/fixtures/workbenches/demo-board"), folder, { recursive: true });
  await mkdir(join(folder, ".vera"), { recursive: true });
  const lock = JSON.stringify({ pid: process.pid, app: "0.0.0", since: "2026-10-11T00:00:00Z" });
  await writeFile(join(folder, ".vera/lock"), lock);
  const app = await launch(join(root, "data"), folder);
  try {
    const page = await app.firstWindow();
    await page.locator('[data-action="open-workbench-nav"]').click();
    await expect(page.locator('[data-workbench="active"]')).toContainText("VERA-DEMO-01");
    const config = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("workbench.config.get", {}),
    );
    expect(config.config.id).toBe("wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C");
    await page.locator('[data-action="edit-workbench-overview"]').click();
    await page.locator('[data-project-section="instructions"]').click();
    await expect(page.locator("#pinned-content")).toHaveAttribute("readonly", "");
    await expect(page.locator("#pinned-content")).toBeEnabled();
    await expect(page.locator("#pinned-content")).toBeFocused();
    await expect(page.locator("[data-project-save]")).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.locator("[data-workbench-entry] .workbench-menu summary").first().click();
    await page.locator('[data-action="close-workbench"]').click();
    expect(await readFile(join(folder, ".vera/lock"), "utf8")).toBe(lock);
    expect(existsSync(join(folder, ".vera/vera.db"))).toBe(false);
    expect(await outboundAttempts(app)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath("demo-readonly.png") });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
// REQ-UX-2c674629 REQ-UX-7f289a2c REQ-UX-68353a4e REQ-FUNC-3815bacc
// REQ-FUNC-4ee03ca8 REQ-FUNC-ad5868a2 REQ-UX-5b390823 REQ-UX-64605f7e REQ-UX-b7002720 REQ-UX-d048dbdd REQ-DATA-4992f40c
// REQ-FUNC-58cba7fd
test("New Workbench creates with the configured draft and offers Open for an existing workbench", async () => {
  // Indexing the created workbench starts the document worker, like office-documents.spec.ts.
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "vera-create-config-"));
  const folder = join(root, "stm32-g4");
  await mkdir(join(folder, ".vera/skills/probe-swd"), { recursive: true });
  await mkdir(join(folder, "datasheets"));
  await mkdir(join(folder, "notes"));
  await mkdir(join(folder, "src"));
  await writeFile(join(folder, "datasheets/stm32g474.pdf"), "%PDF-1.7 fixture");
  await writeFile(join(folder, "notes/bringup.md"), "# Bring-up\n");
  // TASK-581e6591: an office file in a detected folder is offered, selected and indexed on create.
  await cp(
    join(desktop, "../../../tests/fixtures/documents/office/review.docx"),
    join(folder, "notes/review.docx"),
  );
  await writeFile(join(folder, "src/main.c"), "int main(void) { return 0; }\n");
  await writeFile(
    join(folder, ".vera/skills/probe-swd/SKILL.md"),
    "---\nname: probe-swd\ndescription: Attach an SWD probe\n---\nSteps",
  );
  const app = await launch(join(root, "data"), folder);
  try {
    const page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    const create = page.locator("[data-workbench-create]");
    await expect(create).toBeVisible();
    await expect(page.locator('[data-action="open-workbench"], [data-action="open-recent"]')).toHaveCount(0);
    await create.locator('[data-action="choose-create"]').click();
    await expect(create.locator("#workbench-name")).toHaveValue("stm32-g4");
    await create.locator('[data-project-section="documents"]').click();
    await expect(create.locator('[data-docs-folder="datasheets"] input')).toBeChecked();
    await expect(create.locator('[data-docs-folder="notes"] input')).toBeChecked();
    await expect(create.locator('[data-docs-folder="src"]')).toHaveCount(0);
    await expect(create.locator("[data-docs-preview]")).toContainText("Documents to index: 3 (");
    await create.locator('[data-project-section="tools"]').click();
    await create.locator('[data-tool-toggle="web_search"]').uncheck();
    await create.locator('[data-project-section="skills"]').click();
    await expect(create.locator('[data-create-skill="probe-swd"] input')).toBeChecked();
    await create.locator('[data-create-skill="probe-swd"] input').uncheck();
    await create.locator('[data-project-section="agent"]').click();
    await create.locator("[data-project-model]").fill("openai/gpt-5");
    await create.locator("[data-project-model]").press("Enter");
    await expect(page.locator('[data-workbench="active"]')).toHaveCount(0);
    await create.locator('[data-project-section="instructions"]').click();
    await create.locator("#pinned-content").fill("# stm32-g4\n\nDevice under test: STM32G474.\n");
    await create.locator('[data-project-section="embeddings"]').click();
    await create.locator("[data-project-chunk]").fill("800");
    await create.locator("[data-project-overlap]").fill("100");
    await create.locator("[data-retrieval-results]").fill("12");
    await create.locator("[data-retrieval-mode]").selectOption("keyword");
    await create.locator('[data-action="create-workbench"]').click();
    await expect(page.locator('[data-workbench="active"]')).toContainText("stm32-g4");
    const yaml = parse(await readFile(join(folder, ".vera/workbench.yaml"), "utf8"));
    expect(yaml.tools.disabled).toEqual(["web_search"]);
    expect(yaml.docs.include).toEqual(["datasheets/**", "notes/**"]);
    expect(yaml.skills.disabled).toEqual(["probe-swd"]);
    expect(yaml.agent.model).toBe("openai/gpt-5");
    expect(yaml.embeddings).toEqual({ model: "Xenova/bge-small-en-v1.5", chunkSize: 800, overlap: 100 });
    expect(yaml.retrieval).toEqual({ results: 12, mode: "keyword" });
    expect(await readFile(join(folder, ".vera/WORKBENCH.md"), "utf8")).toBe(
      "# stm32-g4\n\nDevice under test: STM32G474.\n",
    );
    // The created workbench indexes the selected folders, the Word file included.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const vera = (window as unknown as { vera: VeraBridge }).vera;
            const { config } = await vera.invoke("workbench.config.get", {});
            const { documents } = await vera.invoke("docs.list", { workbenchId: config.id });
            return documents
              .filter((d) => d.path.startsWith("notes/"))
              .map((d) => `${d.path}:${d.kind}:${d.status}`)
              .sort();
          }),
        { timeout: 30000 },
      )
      .toEqual(["notes/bringup.md:markdown:indexed", "notes/review.docx:document:indexed"]);
    await page.locator("[data-workbench-entry] .workbench-menu summary").first().click();
    await page.locator('[data-action="close-workbench"]').click();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await create.locator('[data-action="choose-create"]').click();
    await expect(create.locator("[data-existing-workbench]")).toBeVisible();
    await expect(create.locator('[data-action="create-workbench"]')).toBeDisabled();
    await create.locator('[data-action="open-existing"]').click();
    await expect(page.locator('[data-workbench="active"]')).toContainText("stm32-g4");
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
