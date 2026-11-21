import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { _electron, expect, type Page } from "@playwright/test";
import type { Channel, Request, Response, VeraBridge } from "@vera/shared";
import { parse } from "yaml";
import { test } from "./fixtures.js";

const invoke = <C extends Channel>(page: Page, channel: C, request: Request<C>): Promise<Response<C>> =>
  page.evaluate(
    async ({ channel, request }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, request as never),
    { channel, request },
  ) as Promise<Response<C>>;

/**
 * Windows PowerShell in Constrained Language Mode cannot run npm.ps1, which it prefers to npm.cmd. On such a
 * host the app gets a first PATH folder holding only an npm.cmd that calls the real one, so `npm test` runs.
 */
async function constrainedNpm(scratch: string, env: Record<string, string>) {
  if (process.platform !== "win32") return;
  const mode = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", "$ExecutionContext.SessionState.LanguageMode"],
    { encoding: "utf8" },
  ).trim();
  const real = join(dirname(process.execPath), "npm.cmd");
  if (mode !== "ConstrainedLanguage" || !existsSync(real)) return;
  const shim = join(scratch, "npm-cmd");
  await mkdir(shim);
  await writeFile(join(shim, "npm.cmd"), `@call "${real}" %*\r\n`);
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  env[key] = `${shim};${env[key] ?? ""}`;
}

async function agent(page: Page) {
  if (!(await page.locator('[data-action="edit-workbench-overview"]').isVisible()))
    await page.locator("[data-workbench-entry] .workbench-group-name").first().click();
  await page.locator('[data-action="edit-workbench-overview"]').click();
  await page.locator('[data-project-section="agent"]').click();
}

test("native command prefix approval persists across restart and removal restores prompting", async () => {
  test.setTimeout(120000);
  const scratch = await mkdtemp(join(tmpdir(), "vera-term02-"));
  const folder = join(scratch, "bench");
  const scripts = join(scratch, "scripts");
  await mkdir(folder);
  await mkdir(scripts);
  await writeFile(join(folder, "package.json"), JSON.stringify({ scripts: { test: "node test.cjs" } }));
  await writeFile(join(folder, "test.cjs"), "console.log(12345);\n");
  for (const [name, command] of [
    ["test", "npm test"],
    ["watch", "npm test -- --watch=false"],
    ["force", "git push --force"],
  ]) {
    await writeFile(
      join(scripts, `${name}.jsonl`),
      // The replay window holds the session's prompt and history; this test checks approvals, not budgets.
      [
        { toolCalls: [{ name: "run_command", args: { command } }], contextWindow: 65536 },
        { text: `Finished ${name}` },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n"),
    );
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = scripts;
  env.VERA_TEST_DIALOG_PATH = folder;
  await constrainedNpm(scratch, env);
  const launch = () =>
    _electron.launch({
      executablePath: resolve(
        "node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      args: [resolve("src/apps/desktop"), `--user-data-dir=${join(scratch, "profile")}`],
      env,
      chromiumSandbox: true,
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("#workbench-name").fill("Command grants");
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    await page.locator('[data-action="new-session"]').click();
    const id = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    if (!id) throw Error("Missing session");
    const send = async (name: string) => {
      await page.locator(`[data-session="${id}"]`).click();
      await invoke(page, "session.model.set", { sessionId: id, modelRef: `replay/${name}` });
      const input = page.getByRole("textbox", { name: "Message", exact: true });
      await expect(input).toBeEnabled();
      await input.fill(`Run ${name}`);
      await input.press("Enter");
    };
    const card = () =>
      page
        .locator("[data-approval-card]")
        .filter({ has: page.getByRole("button", { name: "Approve", exact: true }) })
        .last();
    await page.locator(".composer [data-permission-picker]").selectOption("auto-edit");
    await send("test");
    await expect(card().locator("[data-approval-command]")).toHaveText("npm test");
    await expect(card()).toContainText(folder);
    await expect(card()).toContainText(process.platform === "win32" ? ".exe" : "bash");
    await expect(card().locator("[data-command-prefix]")).toHaveValue("npm test");
    await card().locator("[data-command-always-allow]").click();
    await expect(page.locator("[data-transcript]")).toContainText("Finished test");
    const saved = parse(await readFile(join(folder, ".vera/workbench.yaml"), "utf8"));
    expect(saved.format).toBe(1);
    expect(saved.agent.allowed_commands).toEqual(["npm test"]);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("[data-workbench-entry] .workbench-group-name").click();
    await page.locator(`[data-session="${id}"]`).click();
    await send("watch");
    await expect(page.locator("[data-transcript]")).toContainText("Finished watch");
    let snapshot = await invoke(page, "session.get", { sessionId: id });
    expect(snapshot.snapshot.approvals.at(-1)).toMatchObject({ decision: "approved", by: "mode" });
    expect(snapshot.snapshot.items.filter((item) => item.kind === "tool").at(-1)).toMatchObject({
      status: "ok",
      summary: expect.stringContaining('"exitCode":0'),
    });
    await page.locator(".composer [data-permission-picker]").selectOption("ask");
    await send("test");
    await expect(card().getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
    await card().getByRole("button", { name: "Deny", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled();
    const config = await invoke(page, "workbench.config.get", {});
    await invoke(page, "workbench.config.update", {
      workbenchId: config.config.id,
      patch: { agent: { allowed_commands: ["npm test", "git"] } },
    });
    await page.locator(".composer [data-permission-picker]").selectOption("auto-edit");
    await send("force");
    await expect(card().locator("[data-approval-command]")).toHaveText("git push --force");
    await expect(card().locator("[data-command-always-allow]")).toHaveCount(0);
    await card().getByRole("button", { name: "Deny", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled();
    let credential = await invoke(page, "providers.save", {
      provider: "openai",
      apiKey: "test",
      model: "unused",
    });
    if (credential.status === "consent-required")
      credential = await invoke(page, "providers.save", {
        provider: "openai",
        apiKey: "test",
        model: "unused",
        storageConsent: false,
      });
    expect(credential.status).toBe("saved");
    await invoke(page, "workbench.config.update", {
      workbenchId: config.config.id,
      patch: { description: "Masked grant regression" },
    });
    const maskedGrants = await invoke(page, "workbench.commandPrefixes.list", {
      workbenchId: config.config.id,
    });
    expect(maskedGrants).toHaveLength(2);
    // A stored value under six characters is not treated as a secret, so the labels stay readable.
    expect(maskedGrants.map(({ label }) => label)).toEqual(["npm test", "git"]);
    await agent(page);
    await expect(page.locator("[data-command-prefixes] li code")).toHaveText(["npm test", "git"]);
    await page.locator("[data-chat-detail]").selectOption("minimal");
    await page.locator("[data-project-save]").click();
    await expect(page.locator(".workbench-editor")).toBeHidden();
    expect(
      parse(await readFile(join(folder, ".vera/workbench.yaml"), "utf8")).agent.allowed_commands,
    ).toEqual(["npm test", "git"]);
    await agent(page);
    await page.getByRole("button", { name: "Remove npm test", exact: true }).click();
    await page.locator("[data-project-save]").click();
    await expect(page.locator(".workbench-editor")).toBeHidden();
    expect(
      parse(await readFile(join(folder, ".vera/workbench.yaml"), "utf8")).agent.allowed_commands,
    ).toEqual(["git"]);
    await invoke(page, "providers.remove", { id: "openai" });
    // Credential redaction remains retained until app exit; restart before the command proof.
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("[data-workbench-entry] .workbench-group-name").click();
    await page.locator(`[data-session="${id}"]`).click();
    await send("test");
    await expect(card().locator("[data-approval-command]")).toHaveText("npm test");
    await card().getByRole("button", { name: "Deny", exact: true }).click();
    snapshot = await invoke(page, "session.get", { sessionId: id });
    expect(snapshot.snapshot.approvals.at(-1)).toMatchObject({ decision: "denied", by: "user" });
    if (process.env.VERA_TERM02_EVIDENCE_DIR) {
      await mkdir(process.env.VERA_TERM02_EVIDENCE_DIR, { recursive: true });
      await writeFile(
        join(process.env.VERA_TERM02_EVIDENCE_DIR, "native.json"),
        JSON.stringify({ platform: process.platform, saved, snapshot }, null, 2),
      );
      await page.screenshot({ path: join(process.env.VERA_TERM02_EVIDENCE_DIR, "native.png") });
    }
  } finally {
    await app.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("browser Agent prefix removal uses Save and Cancel in four languages", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await page.goto(`${rendererUrl}/?mock=chat`);
  await page.locator('[data-i18n="nav.welcome"]').click();
  await page.locator("#workbench-name").fill("Prefix editor");
  await page.locator('[data-action="choose-create"]').click();
  await page.locator('[data-action="create-workbench"]').click();
  for (const [language, label] of [
    ["en", "Allowed commands"],
    ["ro", "Comenzi permise"],
    ["de", "Erlaubte Befehle"],
    ["fr", "Commandes autorisées"],
  ]) {
    await page.evaluate(
      async ({ language }) => {
        const { api } = await import(/* @vite-ignore */ `${"/api/index.ts"}`);
        await api.invoke("app.settings.update", { language });
        const { config } = await api.invoke("workbench.config.get", {});
        await api.invoke("workbench.config.update", {
          workbenchId: config.id,
          patch: { agent: { allowed_commands: ["npm test", "git"] } },
        });
      },
      { language },
    );
    await agent(page);
    await expect(page.locator("[data-command-prefixes] h4")).toHaveText(label as string);
    await page.locator("[data-remove-command-prefix]").first().click();
    await page.locator("[data-project-cancel]").click();
    await agent(page);
    await expect(page.locator("[data-command-prefixes] li")).toHaveCount(2);
    await page.locator("[data-remove-command-prefix]").first().click();
    await page.locator("[data-project-save]").click();
    await agent(page);
    await expect(page.locator("[data-command-prefixes] li code")).toHaveText(["git"]);
    await page.locator("[data-project-cancel]").click();
  }
});
