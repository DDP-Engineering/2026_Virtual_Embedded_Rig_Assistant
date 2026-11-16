import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, type Page, test } from "@playwright/test";
import type { Channel, Request, Response, VeraBridge } from "@vera/shared";
import { resolveConfig } from "electron-vite";
import { createServer } from "vite";
import { parse } from "yaml";

const invoke = <C extends Channel>(page: Page, channel: C, request: Request<C>): Promise<Response<C>> =>
  page.evaluate(
    async ({ channel, request }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, request as never),
    { channel, request },
  ) as Promise<Response<C>>;
async function general(page: Page) {
  if (!(await page.locator('[data-action="edit-workbench-overview"]').isVisible()))
    await page.locator("[data-workbench-entry] .workbench-group-name").first().click();
  await page.locator('[data-action="edit-workbench-overview"]').click();
  await page.locator('[data-project-section="general"]').click();
}

test("native additional folder grants persist, authorize Ask operations and revoke pending commands", async () => {
  test.setTimeout(150000);
  const scratch = await mkdtemp(join(tmpdir(), "vera-term03-"));
  const folder = join(scratch, "bench");
  const sibling = join(scratch, "secret-folder");
  const scripts = join(scratch, "scripts");
  const profile = join(scratch, "profile");
  await Promise.all([folder, sibling, scripts, profile].map((path) => mkdir(path)));
  execFileSync("git", ["init", sibling], { windowsHide: true, stdio: "ignore" });
  await writeFile(join(sibling, "notes.txt"), "SIBLING_READ_OK\n");
  await writeFile(join(profile, "protected.txt"), "PROTECTED");
  await symlink(profile, join(sibling, "data-alias"), process.platform === "win32" ? "junction" : "dir");
  const command =
    process.platform === "win32" ? "Write-Output 'SIBLING_COMMAND_OK'" : "printf 'SIBLING_COMMAND_OK\\n'";
  const marker = join(sibling, "must-not-exist.txt");
  const pending =
    process.platform === "win32"
      ? `Set-Content -LiteralPath '${marker.replaceAll("'", "''")}' -Value no`
      : `printf no > '${marker.replaceAll("'", "'\\''")}'`;
  for (const [name, steps] of Object.entries({
    success: [
      { toolCalls: [{ name: "read", args: { path: join(sibling, "notes.txt") } }] },
      { toolCalls: [{ name: "run_command", args: { command, cwd: sibling } }] },
      { text: "Finished success" },
    ],
    denied: [
      { toolCalls: [{ name: "read", args: { path: join(scratch, "unlisted.txt") } }] },
      { toolCalls: [{ name: "run_command", args: { command, cwd: scratch } }] },
      { text: "Finished denied" },
    ],
    protected: [
      { toolCalls: [{ name: "read", args: { path: join(sibling, "data-alias/protected.txt") } }] },
      { toolCalls: [{ name: "write", args: { path: join(sibling, "data-alias/new.txt"), content: "no" } }] },
      { text: "Finished protected" },
    ],
    pending: [
      { toolCalls: [{ name: "run_command", args: { command: pending, cwd: sibling } }] },
      { text: "Finished pending" },
    ],
    removed: [
      { toolCalls: [{ name: "read", args: { path: join(sibling, "notes.txt") } }] },
      { toolCalls: [{ name: "run_command", args: { command, cwd: sibling } }] },
      { text: "Finished removed" },
    ],
  }))
    await writeFile(join(scripts, `${name}.jsonl`), steps.map((step) => JSON.stringify(step)).join("\n"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = scripts;
  env.VERA_TEST_DIALOG_PATH = folder;
  const launch = () =>
    _electron.launch({
      executablePath: resolve(
        "node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      args: [resolve("src/apps/desktop"), `--user-data-dir=${profile}`],
      env,
      chromiumSandbox: true,
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("#workbench-name").fill("Folder grants");
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    await app.evaluate((_electron, path) => {
      process.env.VERA_TEST_DIALOG_PATH = path;
    }, sibling);
    await general(page);
    await page.locator("[data-add-folder]").click();
    await expect(page.locator(".workbench-editor [data-additional-folders] li")).toContainText(sibling);
    await page.locator("[data-project-cancel]").click();
    expect(parse(await readFile(join(folder, ".vera/workbench.yaml"), "utf8")).additional_folders).toEqual(
      [],
    );
    await general(page);
    await page.locator("[data-add-folder]").click();
    await page.locator("[data-project-save]").click();
    await expect(page.locator(".workbench-editor")).toBeHidden();
    await expect(page.locator(".workbench-overview [data-additional-folders] li")).toContainText(sibling);
    await app.close();
    env.VERA_TEST_DIALOG_PATH = sibling;
    app = await launch();
    page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("[data-workbench-entry] .workbench-group-name").click();
    await expect(page.locator(".workbench-overview [data-additional-folders] li")).toContainText(sibling);
    expect(parse(await readFile(join(folder, ".vera/workbench.yaml"), "utf8")).additional_folders).toEqual([
      sibling,
    ]);
    await page.locator('[data-action="new-session"]').click();
    const initialId = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    if (!initialId) throw Error("Missing session");
    let id = initialId;
    const send = async (name: string) => {
      if (name !== "success") {
        const previous = id;
        await page.locator('[data-action="new-session"]').click();
        await expect
          .poll(() => page.locator('[data-session][aria-current="page"]').getAttribute("data-session"))
          .not.toBe(previous);
        const selected = await page
          .locator('[data-session][aria-current="page"]')
          .getAttribute("data-session");
        if (!selected) throw Error("Missing session");
        id = selected;
      }
      await page.locator(`[data-session="${id}"]`).click();
      await invoke(page, "session.model.set", { sessionId: id, modelRef: `replay/${name}` });
      const input = page.getByRole("textbox", { name: "Message", exact: true });
      await expect(input).toBeEnabled();
      await input.fill(name);
      await input.press("Enter");
    };
    const card = () =>
      page
        .locator("[data-approval-card]")
        .filter({ has: page.getByRole("button", { name: "Approve", exact: true }) })
        .last();
    await send("success");
    await expect(card().locator("[data-approval-command]")).toHaveText(command);
    await card().getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.locator("[data-transcript]")).toContainText("Finished success");
    let snapshot = await invoke(page, "session.get", { sessionId: id });
    let tools = snapshot.snapshot.items.filter((item) => item.kind === "tool");
    expect(tools.slice(-2).map((item) => item.status)).toEqual(["ok", "ok"]);
    expect(JSON.stringify(tools)).toContain("SIBLING_READ_OK");
    expect(JSON.stringify(tools)).toContain("SIBLING_COMMAND_OK");
    expect(snapshot.snapshot.approvals.at(-1)).toMatchObject({ decision: "approved", by: "user" });
    const successSnapshot = snapshot;
    await send("denied");
    await expect(page.locator("[data-transcript]")).toContainText("Finished denied");
    snapshot = await invoke(page, "session.get", { sessionId: id });
    expect(
      snapshot.snapshot.items
        .filter((item) => item.kind === "tool")
        .slice(-2)
        .map((item) => item.status),
    ).toEqual(["error", "error"]);
    await send("protected");
    await expect(page.locator("[data-transcript]")).toContainText("Finished protected");
    snapshot = await invoke(page, "session.get", { sessionId: id });
    tools = snapshot.snapshot.items.filter((item) => item.kind === "tool").slice(-2);
    expect(tools.map((item) => item.status)).toEqual(["error", "error"]);
    expect(JSON.stringify(tools)).toContain("VERA application data");
    await send("pending");
    await expect(card().getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
    const config = await invoke(page, "workbench.config.get", {});
    const grants = await invoke(page, "workbench.additionalFolders.list", { workbenchId: config.config.id });
    await invoke(page, "workbench.config.update", {
      workbenchId: config.config.id,
      patch: {},
      removeAdditionalFolders: grants.map(({ id }) => id),
    });
    await card().getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.locator("[data-transcript]")).toContainText("Finished pending");
    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    snapshot = await invoke(page, "session.get", { sessionId: id });
    expect(snapshot.snapshot.items.filter((item) => item.kind === "tool").at(-1)?.status).toBe("error");
    await general(page);
    await page.locator("[data-add-folder]").click();
    await page.locator("[data-project-save]").click();
    await expect(page.locator(".workbench-editor")).toBeHidden();
    let credential = await invoke(page, "providers.save", {
      provider: "openai",
      apiKey: "secret-folder",
      model: "unused",
    });
    if (credential.status === "consent-required")
      credential = await invoke(page, "providers.save", {
        provider: "openai",
        apiKey: "secret-folder",
        model: "unused",
        storageConsent: false,
      });
    expect(credential.status).toBe("saved");
    expect((await invoke(page, "workbench.config.get", {})).config.additional_folders).toEqual([]);
    await general(page);
    await expect(page.locator(".workbench-editor [data-additional-folders] li")).toContainText("[REDACTED]");
    await page.locator("[data-project-name]").fill("Renamed folders");
    await page.locator("[data-project-save]").click();
    await expect(page.locator(".workbench-editor")).toBeHidden();
    expect(parse(await readFile(join(folder, ".vera/workbench.yaml"), "utf8")).additional_folders).toEqual([
      sibling,
    ]);
    await general(page);
    await page.locator("[data-remove-folder]").click();
    await page.locator("[data-project-save]").click();
    await expect(page.locator(".workbench-editor")).toBeHidden();
    expect(parse(await readFile(join(folder, ".vera/workbench.yaml"), "utf8")).additional_folders).toEqual(
      [],
    );
    await expect(page.locator(".workbench-overview [data-additional-folders] li")).toHaveCount(0);
    await send("removed");
    await expect(page.locator("[data-transcript]")).toContainText("Finished removed");
    snapshot = await invoke(page, "session.get", { sessionId: id });
    expect(
      snapshot.snapshot.items
        .filter((item) => item.kind === "tool")
        .slice(-2)
        .map((item) => item.status),
    ).toEqual(["error", "error"]);
    expect(await readFile(join(profile, "protected.txt"), "utf8")).toBe("PROTECTED");
    await expect(stat(join(profile, "new.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    if (process.env.VERA_TERM03_EVIDENCE_DIR) {
      await mkdir(process.env.VERA_TERM03_EVIDENCE_DIR, { recursive: true });
      await writeFile(
        join(process.env.VERA_TERM03_EVIDENCE_DIR, "native.json"),
        JSON.stringify({ platform: process.platform, grants, successSnapshot, snapshot }, null, 2),
      );
      await page.screenshot({ path: join(process.env.VERA_TERM03_EVIDENCE_DIR, "native.png") });
    }
  } finally {
    await app.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("browser General folders Save and Cancel in four locales", async ({ page }) => {
  const config = (await resolveConfig({ root: "src/apps/desktop" }, "serve", "development")).config?.renderer;
  if (!config) throw Error("Missing renderer config");
  const server = await createServer({
    ...config,
    define: { ...config.define, "import.meta.env.VITE_API": JSON.stringify("mock") },
    server: { ...config.server, port: 0, strictPort: false, hmr: false },
  });
  await server.listen();
  try {
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw Error("Missing server");
    await page.goto(`http://127.0.0.1:${address.port}/?mock=chat`);
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("#workbench-name").fill("Folder editor");
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    for (const [language, label] of [
      ["en", "Additional folders"],
      ["ro", "Foldere suplimentare"],
      ["de", "Zusätzliche Ordner"],
      ["fr", "Dossiers supplémentaires"],
    ]) {
      await page.evaluate(async (language) => {
        const { api } = await import(/* @vite-ignore */ `${"/api/index.ts"}`);
        await api.invoke("app.settings.update", { language });
      }, language);
      await general(page);
      await expect(page.locator(".workbench-editor [data-additional-folders] h4")).toHaveText(
        label as string,
      );
      await page.locator("[data-add-folder]").click();
      await page.locator("[data-project-cancel]").click();
      await general(page);
      await expect(page.locator(".workbench-editor [data-additional-folders] li")).toHaveCount(0);
      await page.locator("[data-add-folder]").click();
      await page.locator("[data-project-save]").click();
      await expect(page.locator(".workbench-editor")).toBeHidden();
      await expect(page.locator(".workbench-overview [data-additional-folders] li")).toContainText(
        "/mock/additional-repo",
      );
      await general(page);
      await page.locator("[data-remove-folder]").click();
      await page.locator("[data-project-cancel]").click();
      await general(page);
      await expect(page.locator(".workbench-editor [data-additional-folders] li")).toHaveCount(1);
      await page.locator("[data-remove-folder]").click();
      await page.locator("[data-project-save]").click();
      await expect(page.locator(".workbench-editor")).toBeHidden();
      await expect(page.locator(".workbench-overview [data-additional-folders] li")).toHaveCount(0);
    }
  } finally {
    await server.close();
  }
});
