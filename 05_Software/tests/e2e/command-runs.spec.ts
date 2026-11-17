import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron, expect, type Page, test } from "@playwright/test";
import type { Channel, ProgramRunInfo, Request, Response, VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const invoke = <C extends Channel>(page: Page, channel: C, request: Request<C>): Promise<Response<C>> =>
  page.evaluate(
    async ({ channel, request }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, request as never),
    { channel, request },
  ) as Promise<Response<C>>;
const quote = (value: string) =>
  process.platform === "win32" ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\"'\"'")}'`;

test("agent sibling server is live in Runs, UI Stop kills its tree and full masked log opens in viewer", async () => {
  test.setTimeout(120000);
  const evidence = resolve(process.env.VERA_TERM04_EVIDENCE_DIR ?? "evaluation-outputs/term04/native");
  await mkdir(evidence, { recursive: true });
  const scratch = await realpath(await mkdtemp(join(evidence, "owned-")));
  const secret = "term04-synthetic-secret";
  const bench = join(scratch, "bench"),
    sibling = join(scratch, `sibling-${secret}`),
    scripts = join(scratch, "scripts");
  for (const folder of [bench, sibling, scripts]) await mkdir(folder);
  await writeFile(
    join(sibling, "server.cjs"),
    `
const http = require('node:http');
const { spawn } = require('node:child_process');
const child = process.argv.includes('--child');
if (!child) {
  console.log('FIRST ${secret}');
  process.stdout.write(('retained log line abcdefghijklmnopqrstuvwxyz0123456789\\n').repeat(22000));
  spawn(process.execPath, [__filename, '--child'], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
}
const server = http.createServer((req, res) => res.end(child ? 'child' : 'parent'));
server.listen(0, '127.0.0.1', () => console.log((child ? 'CHILD_READY:' : 'READY:') + server.address().port));
setInterval(() => console.log('heartbeat ${secret}'), 200);
`,
  );
  const command = `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} server.cjs ${secret}`;
  const script = async (name: string, rows: unknown[]) =>
    writeFile(join(scripts, `${name}.jsonl`), rows.map((row) => JSON.stringify(row)).join("\n"));
  await script("start", [
    { toolCalls: [{ name: "run_command", args: { command, cwd: sibling, background: true } }] },
    { text: "Server launched" },
  ]);
  await script("exit", [
    {
      toolCalls: [
        {
          name: "run_command",
          args: {
            command: `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} -e ${quote("process.exit(7)")}`,
          },
        },
      ],
    },
    { text: "Exit checked" },
  ]);
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = scripts;
  env.VERA_TEST_DIALOG_PATH = bench;
  const app = await _electron.launch({
    executablePath: resolve(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    args: [resolve("src/apps/desktop"), `--user-data-dir=${join(scratch, "profile")}`],
    env,
    chromiumSandbox: true,
  });
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("#workbench-name").fill("Command Runs acceptance");
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    const { config } = await invoke(page, "workbench.config.get", {});
    await page.locator('[data-action="new-session"]').click();
    let sessionId = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    if (!sessionId) throw Error("Missing session");
    await page.locator(".composer [data-permission-picker]").selectOption("bypass");
    await page.locator('[data-action="confirm-bypass"]').click();
    const send = async (model: string, response: string) => {
      if (!sessionId) throw Error("Missing current session");
      await invoke(page, "session.model.set", { sessionId, modelRef: `replay/${model}` });
      const input = page.getByRole("textbox", { name: "Message", exact: true });
      await expect(input).toBeEnabled();
      await input.fill(model);
      await input.press("Enter");
      await expect(page.locator("[data-transcript]")).toContainText(response);
      await expect(input).toBeEnabled();
    };
    await send("start", "Server launched");
    await writeFile(
      join(evidence, "start-snapshot.json"),
      JSON.stringify(await invoke(page, "session.get", { sessionId }), null, 2),
    );
    // Admit the command before this value becomes protected; admission rejects known credentials.
    let credential = await invoke(page, "providers.save", {
      provider: "openai",
      apiKey: secret,
      model: "unused",
    });
    if (credential.status === "consent-required")
      credential = await invoke(page, "providers.save", {
        provider: "openai",
        apiKey: secret,
        model: "unused",
        storageConsent: false,
      });
    expect(credential.status).toBe("saved");
    await invoke(page, "app.settings.update", { privacy: { mask: { runs: true } } });
    const runs = async () => (await invoke(page, "runs.list", { workbenchId: config.id })).runs;
    await expect.poll(async () => (await runs()).length).toBe(1);
    const run = (await runs())[0] as ProgramRunInfo;
    expect(run.command).toEqual({
      text: command.replaceAll(secret, "[REDACTED]"),
      cwd: sibling.replaceAll(secret, "[REDACTED]"),
    });
    const log = () => invoke(page, "runs.log", { workbenchId: config.id, id: run.id });
    await expect.poll(async () => (await log()).text).toContain("CHILD_READY:");
    const live = await log();
    const parentPort = Number(live.text.match(/^READY:(\d+)/m)?.[1]);
    const childPort = Number(live.text.match(/^CHILD_READY:(\d+)/m)?.[1]);
    expect(await (await fetch(`http://127.0.0.1:${parentPort}`)).text()).toBe("parent");
    expect(await (await fetch(`http://127.0.0.1:${childPort}`)).text()).toBe("child");
    await script("ready", [
      { toolCalls: [{ name: "program_output", args: { handle: run.id, until: "READY:", waitMs: 1000 } }] },
      { text: "Readiness checked" },
    ]);
    await send("ready", "Readiness checked");
    if ((await page.locator('[data-panel="right"]').count()) === 0)
      await page.locator('[data-toggle="right"]').click();
    await page.locator("#tab-runs").click();
    const row = page.locator(`[data-run="${run.id}"]`);
    await expect(row.locator("[data-run-output]")).toContainText("heartbeat [REDACTED]");
    await expect(row.locator("[data-run-cwd]")).toContainText("sibling-[REDACTED]");
    const duration = await row.locator("[data-run-duration]").textContent();
    await expect.poll(() => row.locator("[data-run-duration]").textContent()).not.toBe(duration);
    await page.screenshot({ path: join(evidence, "live.png") });
    await row.locator('[data-action="run-stop"]').click();
    await expect(row).toHaveAttribute("data-state", "stopped");
    await expect
      .poll(async () => {
        try {
          await fetch(`http://127.0.0.1:${childPort}`);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
    await expect(fetch(`http://127.0.0.1:${parentPort}`)).rejects.toThrow();
    await script("stopped", [
      { toolCalls: [{ name: "program_output", args: { handle: run.id } }] },
      { text: "Stopped checked" },
    ]);
    await send("stopped", "Stopped checked");
    const snapshot = await invoke(page, "session.get", { sessionId });
    const output = snapshot.snapshot.items
      .filter((item) => item.kind === "tool" && item.name === "program_output")
      .at(-1);
    expect(output?.kind === "tool" && JSON.parse(output.summary ?? "{}")).toMatchObject({
      running: false,
      stopped: true,
    });
    const full = await invoke(page, "runs.log", { workbenchId: config.id, id: run.id, full: true });
    expect(full.text).toContain("FIRST [REDACTED]");
    expect(full.truncated).toBe(false);
    expect(live.truncated).toBe(true);
    expect(JSON.stringify({ run, full, live })).not.toContain(secret);
    const raw = await readFile(join(bench, ".vera/runs", `${run.id}.log`), "utf8");
    expect(raw).toContain(`FIRST ${secret}`);
    await row.locator('[data-action="run-log"]').click();
    await expect(page.locator("[data-source-current] .document-body")).toContainText("FIRST [REDACTED]");
    await expect(page.locator(`[data-tab-key="run:${run.id}"]`)).toBeVisible();
    await page.screenshot({ path: join(evidence, "viewer.png") });
    await page.getByRole("tab", { name: "Chat", exact: true }).click();
    await page.locator('[data-action="new-session"]').click();
    sessionId = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    if (!sessionId) throw Error("Missing second session");
    await expect(page.locator("[data-run]")).toHaveCount(0);
    await page.locator(".composer [data-permission-picker]").selectOption("bypass");
    await page.locator('[data-action="confirm-bypass"]').click();
    await send("exit", "Exit checked");
    await expect.poll(async () => (await runs()).find((item) => item.id !== run.id)?.exitCode).toBe(7);
    const final = await runs();
    const finished = final.find((item) => item.id !== run.id);
    expect(finished?.durationMs).toBeGreaterThanOrEqual(0);
    await expect(page.locator(`[data-run="${finished?.id}"]`)).toContainText("exit code 7");
    await expect(page.locator("[data-run]")).toHaveCount(1);
    await page.locator('[data-runs-filter="session"]').selectOption("all");
    await expect(page.locator("[data-run]")).toHaveCount(2);
    expect(await outboundAttempts(app)).toEqual([]);
    await cp(join(bench, ".vera/runs"), join(evidence, "runs"), { recursive: true });
    await writeFile(
      join(evidence, "receipt.json"),
      JSON.stringify(
        {
          platform: process.platform,
          node: process.version,
          command,
          sibling,
          run,
          final,
          parentPort,
          childPort,
          output,
          fullBytes: Buffer.byteLength(full.text),
          rawBytes: Buffer.byteLength(raw),
          snapshot,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
