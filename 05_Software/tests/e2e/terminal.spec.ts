import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron, expect, type Page, test } from "@playwright/test";
import type { Channel, Request, Response, VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const invoke = <C extends Channel>(page: Page, channel: C, request: Request<C>): Promise<Response<C>> =>
  page.evaluate(
    async ({ channel, request }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, request as never),
    { channel, request },
  ) as Promise<Response<C>>;
const quote = (value: string) =>
  process.platform === "win32" ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\"'\"'")}'`;

test("user terminal types interactively, reflows, isolates consent and ships a working native PTY", async () => {
  test.setTimeout(150000);
  const evidence = resolve(process.env.VERA_TERM05_EVIDENCE_DIR ?? "evaluation-outputs/term05/native");
  await mkdir(evidence, { recursive: true });
  const scratch = await realpath(await mkdtemp(join(evidence, "owned-")));
  const bench = join(scratch, "bench"),
    scripts = join(scratch, "scripts"),
    other = join(scratch, "other");
  const secret = "term05-synthetic-provider-credential";
  const backgroundPids: number[] = [];
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (const path of [bench, scripts, other]) await mkdir(path);
  await writeFile(
    join(bench, "terminal-probe.cjs"),
    `
const fs = require('node:fs'); const readline = require('node:readline');
fs.writeFileSync('terminal-probe.pid', String(process.pid));
console.log('CWD:' + process.cwd());
console.log('TTY:' + process.stdin.isTTY + ':' + process.stdout.isTTY);
console.log('MASK_SECRET:${secret}');
console.log('ENV:' + JSON.stringify({user: process.env.TERM05_USER, copied: process.env.TERM05_COPY !== undefined, vera: process.env.VERA_TERM05_CREDENTIAL !== undefined, api: process.env.TERM05_API_KEY !== undefined}));
const input = readline.createInterface({input: process.stdin, output: process.stdout});
input.question('INPUT_READY:', value => {
 console.log('INPUT_OK:' + value);
 console.log('REFLOW_' + '0123456789'.repeat(30) + '_END');
 process.stdout.on('resize', () => console.log('SIZE:' + process.stdout.columns + ':' + process.stdout.rows));
});
setInterval(() => {}, 1000);
`,
  );
  const script = (name: string, rows: unknown[]) =>
    writeFile(join(scripts, `${name}.jsonl`), rows.map((row) => JSON.stringify(row)).join("\n"));
  await script("initial", [{ text: "Ready" }]);
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = scripts;
  env.TERM05_USER = "normal-ok";
  env.TERM05_COPY = secret;
  env.VERA_TERM05_CREDENTIAL = secret;
  env.TERM05_API_KEY = secret;
  const packaged = process.env.VERA_TERM05_APP;
  const app = await _electron.launch({
    executablePath:
      packaged ??
      resolve("node_modules/electron/dist", process.platform === "win32" ? "electron.exe" : "electron"),
    args: [
      ...(packaged ? [] : [resolve("src/apps/desktop")]),
      `--user-data-dir=${join(scratch, "profile")}`,
      ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : []),
    ],
    env,
    chromiumSandbox: true,
  });
  const consoleErrors: string[] = [];
  app.process().stderr?.on("data", (bytes) => consoleErrors.push(String(bytes)));
  try {
    const startup = await app.evaluate(({ app, BrowserWindow }) => ({
      userData: app.getPath("userData"),
      packaged: app.isPackaged,
      lock: app.hasSingleInstanceLock(),
      ready: app.isReady(),
      windows: BrowserWindow.getAllWindows().length,
      argv: process.argv,
    }));
    await writeFile(join(evidence, "startup.json"), JSON.stringify(startup, null, 2));
    await installNetworkGuard(app);
    const page = await app.firstWindow({ timeout: 15000 });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.stack ?? error.message));
    await invoke(page, "app.settings.update", { language: "en", privacy: { mask: { runs: true } } });
    let saved = await invoke(page, "providers.save", { provider: "openai", apiKey: secret, model: "unused" });
    if (saved.status === "consent-required")
      saved = await invoke(page, "providers.save", {
        provider: "openai",
        apiKey: secret,
        model: "unused",
        storageConsent: false,
      });
    expect(saved.status).toBe("saved");
    const workbench = await invoke(page, "workbench.create", { folder: bench, name: "Terminal acceptance" });
    await page.reload();
    await expect(page.locator('[data-toggle="right"]')).toBeVisible();
    await page.keyboard.press("Control+Shift+T");
    await expect(page.locator("#tab-terminal")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".terminal-surface textarea")).toBeAttached();
    const terminals = () => invoke(page, "terminal.list", { workbenchId: workbench.config.id });
    await expect.poll(async () => (await terminals()).length).toBe(1);
    const a = (await terminals())[0];
    if (!a) throw Error("No first terminal");
    const output = () => invoke(page, "terminal.output", { workbenchId: workbench.config.id, id: a.id });
    async function background(
      id: string,
      name: string,
      workbenchId = workbench.config.id,
      exitShell = false,
    ) {
      if (process.platform !== "linux") return undefined;
      await invoke(page, "terminal.input", {
        workbenchId,
        id,
        data: `sleep 600 & echo $! > ${name}.pid${exitShell ? "; exit" : ""}\r`,
      });
      const folder = workbenchId === workbench.config.id ? bench : other;
      await expect
        .poll(async () => {
          try {
            return Number(await readFile(join(folder, `${name}.pid`), "utf8"));
          } catch {
            return 0;
          }
        })
        .toBeGreaterThan(0);
      const pid = Number(await readFile(join(folder, `${name}.pid`), "utf8"));
      backgroundPids.push(pid);
      if (exitShell) await expect.poll(() => alive(pid)).toBe(false);
      else expect(alive(pid)).toBe(true);
      return pid;
    }
    const closeJob = await background(a.id, "close-background");
    await page.locator(".terminal-surface textarea").focus();
    await page.keyboard.type(
      process.platform === "win32" ? "Write-Output ('BUILTIN_' + 'READY')" : "printf 'BUILTIN_%s\\n' 'READY'",
    );
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await output()).output, { timeout: 30000 }).toContain("BUILTIN_READY");
    const command = `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} terminal-probe.cjs`;
    await page.locator(".terminal-surface textarea").focus();
    await page.keyboard.type(command);
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await output()).output).toContain("INPUT_READY:");
    await page.keyboard.type("hello-terminal");
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText("INPUT_OK:hello-terminal");
    await expect.poll(async () => (await output()).output).toContain("TTY:true:true");
    await expect.poll(async () => (await output()).output).toContain("MASK_SECRET:[REDACTED]");
    await expect
      .poll(async () => (await output()).output)
      .toContain('ENV:{"user":"normal-ok","copied":false,"vera":false,"api":false}');
    expect((await output()).output).not.toContain(secret);
    await expect(page.locator(".xterm-rows")).not.toContainText(secret);
    await expect.poll(async () => (await output()).output).toContain(`CWD:${bench}`);
    const wrappedRows = () =>
      page
        .locator(".xterm-rows > div")
        .evaluateAll(
          (rows) =>
            rows
              .map((row) => row.textContent ?? "")
              .filter((text) => /^(?:REFLOW_|[0-9]{10})/.test(text.trim())).length,
        );
    const resizer = page.locator('[data-resize="right"]');
    await resizer.focus();
    await resizer.press("Home");
    await expect.poll(async () => (await output()).output).toMatch(/SIZE:\d+:\d+/);
    await page.waitForTimeout(400);
    const narrow = await wrappedRows();
    const narrowOutput = (await output()).output;
    await resizer.press("End");
    await page.waitForTimeout(500);
    const wide = await wrappedRows();
    expect(narrow).toBeGreaterThan(wide);
    const wideOutput = (await output()).output;
    const pid = Number(await readFile(join(bench, "terminal-probe.pid"), "utf8"));
    await page.screenshot({ path: join(evidence, "terminal.png") });

    const reads: unknown[] = [];
    if (process.env.VERA_TERM05_SKIP_AGENT !== "1") {
      await page.locator('[data-action="new-session"]').click();
      const sessionId = await page
        .locator('[data-session][aria-current="page"]')
        .getAttribute("data-session");
      if (!sessionId) throw Error("No session");
      async function read(name: string, id: string) {
        await script(name, [
          { toolCalls: [{ name: "terminal_read", args: { terminalId: id } }] },
          { text: `Checked ${name}` },
        ]);
        await invoke(page, "session.model.set", {
          sessionId: sessionId as string,
          modelRef: `replay/${name}`,
        });
        await invoke(page, "session.send", { sessionId: sessionId as string, text: name });
        await expect
          .poll(
            async () =>
              (await invoke(page, "session.get", { sessionId: sessionId as string })).snapshot.status,
          )
          .toBe("idle");
        const snapshot = await invoke(page, "session.get", { sessionId: sessionId as string });
        const result = snapshot.snapshot.items
          .filter((item) => item.kind === "tool" && item.name === "terminal_read")
          .at(-1);
        reads.push(result);
        return result?.kind === "tool" ? (result.summary ?? "") : "";
      }
      expect(await read("private", a.id)).toContain("consent");
      await page.locator(".terminal-consent input").click();
      await expect(page.locator(".terminal-consent input")).toBeChecked();
      expect(await read("shared", a.id)).toContain("INPUT_OK:hello-terminal");
      await page.getByRole("button", { name: "New terminal", exact: true }).click();
      await expect.poll(async () => (await terminals()).length).toBe(2);
      const b = (await terminals()).find((terminal) => terminal.id !== a.id);
      if (!b) throw Error("No second terminal");
      await expect(page.locator(".terminal-consent input")).not.toBeChecked();
      expect(await read("other", b.id)).toContain("consent");
      await page.locator(`#terminal-${a.id}`).click();
      await page.locator(".terminal-consent input").click();
      await expect(page.locator(".terminal-consent input")).not.toBeChecked();
      expect(await read("revoked", a.id)).toContain("consent");
      await page.getByRole("button", { name: "Close terminal", exact: true }).click();
      if (closeJob) await expect.poll(() => alive(closeJob)).toBe(false);
      await expect
        .poll(async () =>
          app.evaluate((_electron, childPid) => {
            try {
              process.kill(childPid, 0);
              return true;
            } catch {
              return false;
            }
          }, pid),
        )
        .toBe(false);
      expect(await read("closed", a.id)).not.toContain("INPUT_OK");
    }
    const remaining = (await terminals()).find((terminal) => terminal.id !== a.id);
    const switchJob = remaining
      ? await background(remaining.id, "switch-background", workbench.config.id, true)
      : undefined;
    if (process.platform === "linux" && remaining) {
      await expect
        .poll(async () => (await terminals()).find((row) => row.id === remaining.id)?.running)
        .toBe(false);
      const finished = await invoke(page, "terminal.create", {
        workbenchId: workbench.config.id,
        cols: 80,
        rows: 24,
      });
      const finishedJob = await background(finished.id, "finished-close", workbench.config.id, true);
      await expect
        .poll(async () => (await terminals()).find((row) => row.id === finished.id)?.running)
        .toBe(false);
      await invoke(page, "terminal.close", { workbenchId: workbench.config.id, id: finished.id });
      if (finishedJob) await expect.poll(() => alive(finishedJob)).toBe(false);
    }
    const nextWorkbench = await invoke(page, "workbench.create", {
      folder: other,
      name: "Other terminal workbench",
    });
    if (switchJob) await expect.poll(() => alive(switchJob)).toBe(false);
    const shutdownTerminal =
      process.platform === "linux"
        ? await invoke(page, "terminal.create", { workbenchId: nextWorkbench.config.id, cols: 80, rows: 24 })
        : undefined;
    const shutdownJob = shutdownTerminal
      ? await background(shutdownTerminal.id, "shutdown-background", nextWorkbench.config.id)
      : undefined;
    const stale = await page.evaluate(
      async ({ workbenchId, id }) => {
        try {
          await (window as unknown as { vera: VeraBridge }).vera.invoke("terminal.output", {
            workbenchId,
            id,
          });
          return null;
        } catch (error) {
          return error;
        }
      },
      { workbenchId: workbench.config.id, id: a.id },
    );
    expect(stale).toMatchObject({ code: "CONFLICT" });
    await expect
      .poll(async () =>
        app.evaluate((_electron, childPid) => {
          try {
            process.kill(childPid, 0);
            return true;
          } catch {
            return false;
          }
        }, pid),
      )
      .toBe(false);
    const runtime = await app.evaluate(({ app }) => {
      const require = process
        .getBuiltinModule("node:module")
        .createRequire(`${app.getAppPath()}/package.json`);
      return {
        executable: process.execPath,
        appPath: app.getAppPath(),
        versions: process.versions,
        platform: process.platform,
        arch: process.arch,
        nativeModules: Object.keys(require.cache).filter(
          (path) => path.includes("node-pty") && path.endsWith(".node"),
        ),
      };
    });
    expect(consoleErrors.filter((error) => /Content Security Policy|Refused to apply/.test(error))).toEqual(
      [],
    );
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    if (shutdownJob) await expect.poll(() => alive(shutdownJob)).toBe(false);
    await writeFile(
      join(evidence, "receipt.json"),
      JSON.stringify(
        {
          runtime,
          command,
          narrow,
          wide,
          narrowOutput,
          wideOutput,
          reads,
          consoleErrors,
          pid,
          backgroundPids,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const page = app.windows()[0];
    await writeFile(
      join(evidence, "failure.json"),
      JSON.stringify(
        {
          error: error instanceof Error ? error.stack : String(error),
          consoleErrors,
          body: page ? await page.locator("body").innerText() : null,
        },
        null,
        2,
      ),
    );
    if (page) await page.screenshot({ path: join(evidence, "failure.png") });
    throw error;
  } finally {
    for (const pid of backgroundPids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* The owned test job already exited. */
      }
    }
    await app.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
