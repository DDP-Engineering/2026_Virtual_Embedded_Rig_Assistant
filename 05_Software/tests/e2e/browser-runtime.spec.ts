import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { _electron, type ElectronApplication, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import type { BrowserFixtureApi } from "../../src/apps/desktop/src/main/browser/fixture.js";
import { browserRelease } from "../../src/apps/desktop/src/main/browser/release.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const archive = process.env.VERA_TEST_BROWSER_ARCHIVE;
const packaged = process.env.VERA_BROWSER_PACKAGED_APP;
const evidence = process.env.VERA_BROWSER_EVIDENCE;
const desktop = resolve("src/apps/desktop");

declare global {
  var veraTestBrowser: BrowserFixtureApi;
}

function splitCommandLine(commandLine: string): string[] {
  return (commandLine.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map((arg) => arg.replaceAll('"', ""));
}

async function processArguments(pid: number): Promise<string[]> {
  if (process.platform === "linux") {
    const args = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0").filter(Boolean);
    // A Chromium process can replace argv with a single, space-delimited process title.
    return args.length > 1 ? args : splitCommandLine(args[0] ?? "");
  }
  const { stdout } = await promisify(execFile)(
    join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`,
    ],
    { timeout: 5000 },
  );
  return splitCommandLine(stdout);
}

async function openFixture(instance: ElectronApplication, sessionId: string, seed?: string) {
  const session = await instance.evaluate(
    (_electron, values) => globalThis.veraTestBrowser.open(values.sessionId, values.seed),
    { sessionId, seed },
  );
  const flags = await processArguments(session.pid);
  const profile = flags.find((arg) => arg.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length);
  if (!profile)
    throw new Error(`Chromium process ${session.pid} did not expose an owned user-data directory`);
  return { ...session, flags, profile };
}

test("verified visible Chromium keeps session state isolated and releases its process and profile", async () => {
  test.skip(!archive, "Set VERA_TEST_BROWSER_ARCHIVE to the pinned official archive for this platform");
  test.setTimeout(155_000);

  const scratch = await realpath(await mkdtemp(join(tmpdir(), "vera-browser-acceptance-")));
  const userData = join(scratch, "data");
  const folder = join(scratch, "bench");
  let app: ElectronApplication | undefined;

  async function start(restart = false) {
    const instance = await _electron.launch({
      executablePath: packaged
        ? resolve(packaged)
        : resolve("node_modules/electron/dist", process.platform === "win32" ? "electron.exe" : "electron"),
      args: [...(packaged ? [] : [desktop]), `--user-data-dir=${userData}`],
      chromiumSandbox: true,
      env: { ...process.env, VERA_TEST_BROWSER_ARCHIVE: resolve(archive ?? "") },
    });
    app = instance;
    await installNetworkGuard(instance);
    const page = await instance.firstWindow();
    expect(await instance.evaluate(({ app }) => app.isPackaged)).toBe(Boolean(packaged));
    await page.evaluate(
      async ({ folder, restart }) => {
        const { vera } = window as unknown as { vera: VeraBridge };
        if (restart) await vera.invoke("workbench.open", { folder });
        else await vera.invoke("workbench.create", { folder, name: "Browser acceptance" });
      },
      { folder, restart },
    );
    return { instance, page };
  }

  async function running(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0);
      if (process.platform === "linux") {
        // WSL can defer reaping children after the browser process is terminated.
        const state = await readFile(`/proc/${pid}/stat`, "utf8");
        return state.slice(state.lastIndexOf(")") + 2, state.lastIndexOf(")") + 3) !== "Z";
      }
      return true;
    } catch {
      return false;
    }
  }

  const waitForDisposal = async ({
    pid,
    profile,
    childPids,
  }: {
    pid: number;
    profile: string;
    childPids: number[];
  }) => {
    await expect
      .poll(
        async () => {
          const pids = [pid, ...childPids];
          const live = await Promise.all(pids.map((processId) => running(processId)));
          return pids.filter((_processId, index) => live[index]);
        },
        { timeout: 10000 },
      )
      .toEqual([]);
    await expect
      .poll(() =>
        access(profile).then(
          () => true,
          () => false,
        ),
      )
      .toBe(false);
  };

  try {
    await mkdir(folder);
    const { instance, page } = await start();
    expect(await instance.evaluate(() => globalThis.veraTestBrowser.status())).toEqual({ phase: "missing" });
    expect(await instance.evaluate(() => globalThis.veraTestBrowser.install())).toEqual({
      phase: "ready",
      version: browserRelease()?.version,
    });
    const first = await openFixture(instance, "first", "synthetic");
    const second = await openFixture(instance, "second");
    expect(first.initialTabs).toBe(0);
    expect(first.state).toEqual({
      cookies: "fixture=synthetic",
      storage: "synthetic",
      text: "Rendered by JavaScript",
      visibility: "visible",
    });
    expect(second.initialTabs).toBe(0);
    expect(second.state).toEqual({
      cookies: "",
      storage: null,
      text: "Rendered by JavaScript",
      visibility: "visible",
    });
    expect(second.pid).not.toBe(first.pid);
    expect(first.childPids.length).toBeGreaterThan(0);
    expect(second.childPids.length).toBeGreaterThan(0);
    expect(second.profile).not.toBe(first.profile);
    expect(first.profile).toContain("playwright_chromiumdev_profile");
    expect(first.product).toContain(browserRelease()?.version ?? "unknown pinned version");
    expect(first.flags.filter((flag) => /^--(?:headless|no-sandbox|disable-.*sandbox)/.test(flag))).toEqual(
      [],
    );
    if (process.platform === "linux") {
      expect(first.sandbox).toMatch(/PID namespaces\s+Yes/i);
      expect(first.sandbox).toMatch(/Seccomp-BPF sandbox\s+Yes/i);
    }

    process.kill(second.pid);
    await waitForDisposal(second);
    const recovered = await openFixture(instance, "second");
    expect(recovered.state.cookies).toBe("");
    await page.evaluate(async () => {
      const { vera } = window as unknown as { vera: VeraBridge };
      await vera.invoke("workbench.close", {});
    });
    await Promise.all([waitForDisposal(first), waitForDisposal(recovered)]);

    await page.evaluate(async (folder) => {
      const { vera } = window as unknown as { vera: VeraBridge };
      await vera.invoke("workbench.open", { folder });
    }, folder);
    const beforeQuit = await openFixture(instance, "first", "beforequit");
    expect(await outboundAttempts(instance)).toEqual([]);
    await instance.close();
    app = undefined;
    await waitForDisposal(beforeQuit);
    const restarted = await start(true);
    expect(await restarted.instance.evaluate(() => globalThis.veraTestBrowser.status())).toMatchObject({
      phase: "ready",
    });
    const afterQuit = await openFixture(restarted.instance, "first");
    expect(afterQuit.initialTabs).toBe(0);
    expect(afterQuit.state.cookies).toBe("");
    expect(afterQuit.state.storage).toBeNull();
    await restarted.instance.evaluate(() => globalThis.veraTestBrowser.close("first"));
    await waitForDisposal(afterQuit);

    if (evidence) {
      await writeFile(
        resolve(evidence),
        JSON.stringify(
          {
            platform: process.platform,
            packaged: Boolean(packaged),
            chromium: first.product,
            profileIsolation: true,
            stateIsolation: true,
            processExitAndCleanup: true,
            workbenchCloseAndCleanup: true,
            restartAndCleanup: true,
            linuxSandbox: first.sandbox,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await app?.close();
    await rm(scratch, { force: true, recursive: true, maxRetries: 5, retryDelay: 250 });
  }
});
