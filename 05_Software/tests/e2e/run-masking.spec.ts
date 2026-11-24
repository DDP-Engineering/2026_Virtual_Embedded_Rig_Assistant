import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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

test("Program runs follows live app/workbench masking for actual MQTT-secret output, statuses and full viewer", async () => {
  test.setTimeout(180000);
  const evidence = resolve("test-outputs/mask03/native");
  await mkdir(evidence, { recursive: true });
  const scratch = await realpath(await mkdtemp(join(evidence, "owned-")));
  const secret = "mask03-mqtt-credential";
  const folder = join(scratch, `bench-${secret}`),
    other = join(scratch, "other"),
    scripts = join(scratch, "scripts"),
    pkg = join(scratch, "probe-tools");
  for (const path of [folder, other, scripts, pkg]) await mkdir(path);
  await writeFile(
    join(folder, "print.cjs"),
    `const fs=require('node:fs'); const timer=setInterval(()=>{if(fs.existsSync('release')){clearInterval(timer);console.log('STORED ${secret}'); setInterval(()=>{if(fs.existsSync('finish'))process.exit(7)},50);}},50); console.log('READY');`,
  );
  const command = `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} print.cjs ${secret}`;
  await writeFile(
    join(scripts, "start.jsonl"),
    [{ toolCalls: [{ name: "run_command", args: { command, background: true } }] }, { text: "Started" }]
      .map((row) => JSON.stringify(row))
      .join("\n"),
  );
  await writeFile(
    join(pkg, "plugin.yaml"),
    JSON.stringify({
      format: 1,
      id: "probe-tools",
      name: "Probe tools",
      version: "0.1.0",
      summary: "Fixture summary.",
      description: "Fixture status output.",
      ecosystem: "general",
      platforms: ["windows-x64", "linux-x64"],
      programs: {
        node: {
          install: {
            find: { windows: [process.execPath], linux: [process.execPath] },
            hint: `Install ${secret}`,
          },
          version: { args: ["-e", `console.log('${secret}')`], match: "(.+)" },
        },
      },
      rules: [],
    }),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = scripts;
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
    await invoke(page, "app.settings.update", { language: "en" });
    const bench = await invoke(page, "workbench.create", { folder, name: "Run masking" });
    const id = bench.config.id;
    const session = await invoke(page, "session.create", {
      workbenchId: id,
      modelRef: "replay/start",
      mode: "bypass",
      acknowledged: true,
    });
    await page.locator(`[data-session="${session.id}"]`).click();
    await invoke(page, "session.send", { sessionId: session.id, text: "start" });
    const runs = async () => (await invoke(page, "runs.list", { workbenchId: id })).runs;
    await expect.poll(async () => (await runs()).length).toBe(1);
    const run = (await runs())[0] as ProgramRunInfo;
    const log = (full = false) =>
      invoke(page, "runs.log", { workbenchId: id, id: run.id, ...(full ? { full: true } : {}) });
    await expect.poll(async () => (await log()).text).toContain("READY");
    // The command was admitted before enrollment; output is released only after the MQTT secret is stored.
    expect(
      (await invoke(page, "mqtt.credentials.save", { ref: "mask03", password: secret, storageConsent: true }))
        .status,
    ).toBe("saved");
    await writeFile(join(folder, "release"), "go");
    await expect.poll(async () => (await log()).text).toContain(`STORED ${secret}`);
    expect((await runs())[0]?.args.join(" ")).toContain(secret);
    expect((await runs())[0]?.command).toEqual({ text: command, cwd: folder });
    const review = await invoke(page, "plugins.review", { path: pkg });
    await invoke(page, "plugins.install", { path: pkg, sha256: review.sha256 });
    const status = () => invoke(page, "plugins.programs", { id: "probe-tools", workbenchId: id });
    expect(JSON.stringify(await status())).toContain(secret);
    if ((await page.locator('[data-panel="right"]').count()) === 0)
      await page.locator('[data-toggle="right"]').click();
    await page.locator("#tab-runs").click();
    const setApp = (runs: boolean, display = false) =>
      invoke(page, "app.settings.update", { privacy: { mask: { runs, display } } });
    const setChoice = (runs: "on" | "off" | "default") =>
      invoke(page, "workbench.config.update", { workbenchId: id, patch: { privacy: { mask: { runs } } } });
    const row = page.locator(`[data-run="${run.id}"]`);
    await expect(row).toContainText(secret);
    await expect(row).toHaveAttribute("data-state", "running");
    await row.locator('[data-action="run-log"]').click();
    await expect(page.locator("dialog .approval-command")).toContainText(secret);
    await setApp(true);
    await expect(page.locator("dialog .approval-command")).not.toContainText(secret);
    await expect(page.locator("dialog [data-run-log]")).toContainText("STORED [REDACTED]");
    await expect(row).not.toContainText(secret);
    await setApp(false);
    await expect(page.locator("dialog [data-run-log]")).toContainText(secret);
    await page.locator('[data-action="run-log-close"]').click();
    await writeFile(join(folder, "finish"), "go");
    await expect.poll(async () => (await log()).running).toBe(false);
    await expect(row).toHaveAttribute("data-state", "exited");
    await row.locator('[data-action="run-log"]').click();
    const viewer = page.locator("[data-source-current] .document-body");
    await expect(viewer).toContainText(`STORED ${secret}`);
    await setApp(true);
    await expect(viewer).toContainText("STORED [REDACTED]");
    await expect(row).not.toContainText(secret);
    expect(JSON.stringify(await status())).not.toContain(secret);
    expect((await log(true)).text).toContain("[REDACTED]");
    await setChoice("off");
    await expect(viewer).toContainText(secret);
    await expect(row).toContainText(secret);
    await setApp(false, true);
    await setChoice("on");
    await expect(viewer).toContainText("[REDACTED]");
    expect((await log()).text).not.toContain(secret);
    await setChoice("default");
    await expect(viewer).toContainText(secret);
    expect(JSON.stringify(await status())).toContain(secret);
    await page.locator('[data-action="plugins-nav"]').click();
    await page.locator('[data-library-status="installed"]').click();
    const pluginCard = page.locator('[data-plugin="probe-tools"]');
    await pluginCard.locator('[data-action="plugin-expand"]').click();
    await pluginCard.locator('[data-action="plugin-check"]').click();
    const programStatus = pluginCard.locator('[data-program="node"][data-state]');
    await expect(programStatus).toContainText(secret);
    await setApp(true);
    await expect(programStatus).not.toContainText(secret);
    await expect(programStatus).toContainText("[REDACTED]");
    await setChoice("off");
    await expect(programStatus).toContainText(secret);
    await setChoice("default");
    await expect(programStatus).not.toContainText(secret);
    await setApp(false);
    await expect(programStatus).toContainText(secret);
    const raw = await readFile(join(folder, ".vera/runs", `${run.id}.log`), "utf8");
    expect(raw).toContain(`STORED ${secret}`);
    // Local terminals use the same live choice, independently of terminal_read consent.
    const terminal = await invoke(page, "terminal.create", { workbenchId: id, cols: 80, rows: 24 });
    await invoke(page, "terminal.input", {
      workbenchId: id,
      id: terminal.id,
      data: process.platform === "win32" ? `Write-Output '${secret}'\r` : `printf '${secret}\n'\n`,
    });
    const terminalOutput = () => invoke(page, "terminal.output", { workbenchId: id, id: terminal.id });
    await expect.poll(async () => (await terminalOutput()).output).toContain(secret);
    await setApp(true);
    await expect.poll(async () => (await terminalOutput()).output).not.toContain(secret);
    await setApp(false);
    await expect.poll(async () => (await terminalOutput()).output).toContain(secret);
    await invoke(page, "terminal.close", { workbenchId: id, id: terminal.id });
    const second = await invoke(page, "workbench.create", {
      folder: other,
      name: "Other",
      config: { privacy: { mask: { runs: "on" } } },
    });
    const foreign = await page.evaluate(
      async ({ workbenchId, runId }) => {
        try {
          await (window as unknown as { vera: VeraBridge }).vera.invoke("runs.log", {
            workbenchId,
            id: runId,
          });
          return "allowed";
        } catch (error) {
          return (error as { code?: string }).code;
        }
      },
      { workbenchId: id, runId: run.id },
    );
    expect(foreign).toBe("CONFLICT");
    expect((await invoke(page, "runs.list", { workbenchId: second.config.id })).runs).toEqual([]);
    expect(
      JSON.stringify(
        await invoke(page, "plugins.programs", { id: "probe-tools", workbenchId: second.config.id }),
      ),
    ).not.toContain(secret);
    expect(await outboundAttempts(app)).toEqual([]);
    await writeFile(
      join(evidence, "receipt.json"),
      JSON.stringify(
        {
          platform: process.platform,
          node: process.version,
          base: "cb8f0bcd15d9895c51d5d222ceb9b33f780daba8",
          run,
          raw,
          second: second.config.id,
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
