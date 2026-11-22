import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { _electron, type ElectronApplication, expect, type Locator, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { browserRelease } from "../../src/apps/desktop/src/main/browser/release.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const archive = process.env.VERA_TEST_BROWSER_ARCHIVE;
const packaged = process.env.VERA_BROWSER_PACKAGED_APP;
const evidence = process.env.VERA_BROWSER_EVIDENCE;
const origin = "https://docs.vera-browser.example.com";
const otherOrigin = "https://other.vera-browser.example.com";
const final = `${origin}/agent-final`;
const call = (name: string, args = {}) => ({ toolCalls: [{ name: `browser_${name}`, args }] });
const open = (url: string) => call("open", { url });

async function nativeProcessRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
    }
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH" || code === "ENOENT") return false;
    throw error;
  }
}

async function verifyNativeExit(pid: number | undefined) {
  if (!pid) throw new Error("Expected a PID for the owned Chromium process");
  await expect.poll(() => nativeProcessRunning(pid), { timeout: 15_000 }).toBe(false);
}

test("Interactive Browser Settings and owned Chat controls work through Desktop", async () => {
  test.skip(!archive, "Set VERA_TEST_BROWSER_ARCHIVE to the pinned official archive");
  test.setTimeout(240_000);
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "vera-browser-ui-")));
  let app: ElectronApplication | undefined;
  try {
    const folder = join(scratch, "bench");
    const replay = join(scratch, "replay");
    await mkdir(folder);
    await mkdir(replay);
    async function script(model: string, ...steps: object[]) {
      await writeFile(join(replay, `${model}.jsonl`), steps.map((step) => JSON.stringify(step)).join("\n"));
    }
    await script("missing", open(`${origin}/agent-start`), { text: "Browser availability checked." });
    await script(
      "first",
      open(`${origin}/agent-start`),
      call("snapshot"),
      call("follow", { ref: "{{snapshotId}}:1" }),
      call("snapshot"),
      open(`${otherOrigin}/denied`),
      { text: `The source reports 3.3 V. [Reference voltage](${final})` },
    );
    await script("second", open(`${origin}/agent-page`), { text: "Second browser page opened." });
    await script("stop", open(`${origin}/pending`), { text: "Pending operation completed." });

    const instance = await _electron.launch({
      executablePath: packaged
        ? resolve(packaged)
        : resolve("node_modules/electron/dist", process.platform === "win32" ? "electron.exe" : "electron"),
      args: [...(packaged ? [] : [resolve("src/apps/desktop")]), `--user-data-dir=${join(scratch, "data")}`],
      chromiumSandbox: true,
      env: { ...process.env, VERA_REPLAY_DIR: replay, VERA_TEST_BROWSER_ARCHIVE: resolve(archive ?? "") },
    });
    app = instance;
    await installNetworkGuard(instance);
    expect(await instance.evaluate(({ app }) => app.isPackaged)).toBe(Boolean(packaged));
    const page = await instance.firstWindow();
    const { workbenchId, sessions } = await page.evaluate(async (folder) => {
      const { vera } = window as unknown as { vera: VeraBridge };
      const { config } = await vera.invoke("workbench.create", { folder, name: "Browser controls" });
      await vera.invoke("app.settings.update", { language: "en" });
      const sessions: Record<string, string> = {};
      for (const model of ["missing", "first", "second", "stop"]) {
        const { id } = await vera.invoke("session.create", {
          reuseEmpty: false,
          modelRef: `replay/${model}`,
        });
        await vera.invoke("session.rename", { sessionId: id, title: `Browser ${model}` });
        sessions[model] = id;
      }
      return { workbenchId: config.id, sessions };
    }, folder);
    const first = sessions.first ?? "";
    const second = sessions.second ?? "";
    const stop = sessions.stop ?? "";

    async function settingsPage() {
      await page.locator('[data-i18n="nav.settings"]').click();
      await page.locator('[data-section="web"]').click();
    }
    async function select(sessionId: string) {
      const back = page.locator('[data-action="leave-settings"]');
      if (await back.isVisible()) await back.click();
      await page.locator(`[data-session="${sessionId}"]`).click();
      await expect(chat).toBeVisible();
    }
    async function grant(value = origin, keyboard = false) {
      const input = chat.getByRole("textbox", { name: "Public origin" });
      await input.fill(value);
      if (keyboard) await input.press("Enter");
      else await chat.getByRole("button", { name: "Grant access" }).click();
    }
    async function send(message: string) {
      await page.locator("#chat-message").fill(message);
      await page.locator('[data-action="send-message"]').click();
    }
    const inspect = (id: string, sandbox = false) =>
      instance.evaluate(
        (_electron, args) => globalThis.veraTestBrowser.inspectUiBrowser(args.id, args.sandbox),
        { id, sandbox },
      );
    const allowed = (id: string) =>
      instance.evaluate((_electron, sessionId) => globalThis.veraTestBrowser.allowed(sessionId), id);
    const receipts = () => instance.evaluate(() => globalThis.veraTestBrowser.receipts());
    const session = (sessionId: string) =>
      page.evaluate(async (sessionId) => {
        const { vera } = window as unknown as { vera: VeraBridge };
        return (await vera.invoke("session.get", { sessionId })).snapshot;
      }, sessionId);
    const ready = async (id: string) => {
      await expect
        .poll(async () => (await session(id)).turns.at(-1)?.stopReason, { timeout: 40_000 })
        .toBe("end");
      return session(id);
    };
    const chat = page.getByRole("region", { name: "Interactive Browser" });
    const current = chat.locator(".chat-browser-location bdi");
    const origins = chat.getByRole("list", { name: "Granted origins" });
    const show = chat.getByRole("button", { name: "Show browser" });
    const revoke = chat.getByRole("button", { name: "Revoke access" });
    const close = chat.getByRole("button", { name: "Close browser" });
    const settings = page.getByRole("group", { name: "Interactive Browser" });
    const uiStatus = settings.getByRole("status");
    const appOptIn = settings.getByRole("checkbox", { name: "Enable Interactive Browser in VERA" });
    const benchOptIn = settings.getByRole("checkbox", {
      name: "Allow Interactive Browser in this workbench",
    });
    const install = settings.getByRole("button", { name: "Install browser runtime" });
    const cancel = settings.getByRole("button", { name: "Cancel installation" });
    // The switches belong to the Web access page draft: each change is saved with the page header Save.
    async function toggle(checkbox: Locator, enabled: boolean) {
      await checkbox.click();
      await expect(checkbox).toBeChecked({ checked: enabled });
      await page.locator("[data-settings-save]").click();
      await expect(page.locator("[data-settings-header]")).toHaveAttribute("aria-busy", "false");
      await expect(page.locator("[data-settings-save]")).toBeDisabled();
      await expect(checkbox).toBeChecked({ checked: enabled });
      await expect(checkbox).toBeEnabled();
    }

    await page.reload();
    await settingsPage();
    await expect(uiStatus).toHaveText("Browser runtime is not installed.");
    await expect(appOptIn).not.toBeChecked();
    await expect(benchOptIn).not.toBeChecked();
    await toggle(appOptIn, true);
    await expect(benchOptIn).not.toBeChecked();
    await toggle(benchOptIn, true);
    await select(sessions.missing ?? "");
    await grant();
    await expect(origins).toHaveText(origin);
    await send("Check a page with the browser missing");
    const availability = await ready(sessions.missing ?? "");
    const missingTool = availability.items.find(
      (item) => item.kind === "tool" && item.name === "browser_open",
    );
    expect(missingTool).toMatchObject({ kind: "tool", name: "browser_open", status: "error" });
    expect(missingTool?.kind === "tool" ? (missingTool.preview ?? missingTool.summary) : "").toContain(
      "runtime-missing",
    );
    await expect(chat.locator('[data-browser-failure="runtime-missing"]')).toHaveText(
      "Install the browser runtime in Settings → Web access.",
    );
    await expect(show).toHaveCount(0);

    await settingsPage();
    await instance.evaluate(() => globalThis.veraTestBrowser.setNextTransfer("fail"));
    await install.click();
    await expect(uiStatus).toHaveText("Browser download failed. Check your connection and try again.");
    await instance.evaluate(() => globalThis.veraTestBrowser.setNextTransfer("hold"));
    await install.click();
    await expect(uiStatus).toHaveAttribute("data-browser-runtime", "downloading");
    await cancel.click();
    await expect(uiStatus).toHaveText("Browser installation cancelled.");
    await install.click();
    await expect(uiStatus).toHaveText(`Chromium ${browserRelease()?.version} is ready.`, { timeout: 70_000 });

    for (const [language, title, label] of [
      ["ro", "Browser interactiv", "Elimină browserul"],
      ["de", "Interaktiver Browser", "Browser-Laufzeit entfernen"],
      ["fr", "Navigateur interactif", "Supprimer le navigateur"],
      ["en", "Interactive Browser", "Remove browser runtime"],
    ] as const) {
      await page.evaluate(
        (language) =>
          (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.update", { language }),
        language,
      );
      await expect(
        page.getByRole("group", { name: title }).getByRole("button", { name: label }),
      ).toBeVisible();
    }

    await select(first);
    await grant(`${origin}/not-an-origin`);
    await expect(chat.getByRole("alert")).toHaveText(
      "Destination denied. Grant the exact public HTTP or HTTPS origin to browse there.",
    );
    await expect(origins).toHaveCount(0);
    const refused = await page.evaluate(
      async ({ workbenchId, sessionId }) => {
        const { vera } = window as unknown as { vera: VeraBridge };
        const errorCode = (error: { code: string }) => error.code;
        return Promise.all([
          vera
            .invoke("browser.session.grant", { workbenchId, sessionId, origin: "https://example.com" })
            .then(() => "granted", errorCode),
          vera
            .invoke("browser.session.get", { workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", sessionId })
            .then(() => "read", errorCode),
        ]);
      },
      { workbenchId, sessionId: first },
    );
    expect(refused).toEqual(["DENIED", "CONFLICT"]);
    await grant(origin, true);
    await expect(origins).toHaveText(origin);
    await send("Read the rendered page and follow the link");
    const firstRun = await ready(first);
    await expect(current).toHaveText(final);
    await expect(chat.locator('[data-browser-failure="destination-denied"]')).toBeVisible();
    await expect(chat).not.toContainText(otherOrigin);
    const rendered = firstRun.items.find((item) => item.kind === "tool" && item.name === "browser_snapshot");
    if (rendered?.kind !== "tool") throw new Error("Expected a rendered browser snapshot");
    const renderedText = rendered.truncated?.preview
      ? (
          await page.evaluate(
            (request) =>
              (window as unknown as { vera: VeraBridge }).vera.invoke("session.item.detail", request),
            { sessionId: first, itemId: rendered.id, field: "preview" as const },
          )
        ).text
      : (rendered.preview ?? rendered.summary);
    expect(renderedText).toContain("Rendered by JavaScript");
    expect(firstRun.items).toContainEqual(
      expect.objectContaining({
        kind: "assistant",
        text: `The source reports 3.3 V. [Reference voltage](${final})`,
      }),
    );

    await instance.evaluate(
      (_electron, args) => globalThis.veraTestBrowser.observeUiShow(args.id, args.url),
      { id: first, url: final },
    );
    await show.click();
    await expect.poll(() => inspect(first), { timeout: 20_000 }).toMatchObject({ showCalls: 1 });
    const browser = await inspect(first, true);
    expect(browser).toMatchObject({
      product: `Chrome/${browserRelease()?.version}`,
      url: final,
      visibility: "visible",
    });
    expect(browser?.pid).toBeGreaterThan(0);
    if (process.platform === "linux") {
      expect(browser?.sandbox).toMatch(/PID namespaces\s+Yes/);
      expect(browser?.sandbox).toMatch(/Network namespaces\s+Yes/);
      expect(browser?.sandbox).toMatch(/Seccomp-BPF sandbox\s+Yes/);
    }
    let commandLine: string | undefined;
    if (process.platform === "win32") {
      const { stdout } = await promisify(execFile)(
        join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter 'ProcessId=${browser?.pid}').CommandLine`,
        ],
        { timeout: 10_000 },
      );
      expect(stdout).toContain("--user-data-dir=");
      expect(stdout).not.toMatch(/--(?:no-sandbox|disable-setuid-sandbox)\b/);
      commandLine = stdout.match(/--user-data-dir=/)?.[0];
    }

    await select(second);
    await expect(origins).toHaveCount(0);
    await expect(current).toHaveCount(0);
    await expect(show).toHaveCount(0);
    await grant();
    await expect(origins).toHaveText(origin);
    await page.context().setOffline(true);
    try {
      await revoke.click();
      await expect(origins).toHaveCount(0);
    } finally {
      await page.context().setOffline(false);
    }
    await grant();
    await send("Open a page in this separate browser");
    await ready(second);
    await expect(current).toHaveText(`${origin}/agent-page`);
    const secondPid = (await inspect(second))?.pid;
    expect(secondPid).toBeGreaterThan(0);
    expect(secondPid).not.toEqual(browser?.pid);
    await page.reload();
    await select(first);
    await expect(current).toHaveText(final);
    await expect(origins).toHaveText(origin);
    await select(second);
    await expect(current).toHaveText(`${origin}/agent-page`);
    await instance.evaluate((_electron, id) => globalThis.veraTestBrowser.closeUiWindow(id), second);
    await expect(chat.locator('[data-browser-failure="window-closed"]')).toHaveText(
      "The browser window closed. Grant access to browse again.",
    );
    await expect(origins).toHaveCount(0);
    await expect(current).toHaveCount(0);
    await expect(show).toHaveCount(0);
    await expect(close).toHaveCount(0);
    expect(await allowed(second)).toEqual([]);
    await verifyNativeExit(secondPid);
    await page.reload();
    await select(second);
    await expect(chat.getByRole("status")).toHaveText("No browser open");
    await expect(chat.locator("[data-browser-failure]")).toHaveCount(0);
    await expect(current).toHaveCount(0);
    await select(first);
    await expect(current).toHaveText(final);
    await close.click();
    await expect(current).toHaveCount(0);
    await expect(origins).toHaveCount(0);
    await expect.poll(() => inspect(first)).toBe(null);
    await verifyNativeExit(browser?.pid);

    await select(stop);
    await grant();
    await send("Open a deliberately pending browser page");
    await expect
      .poll(async () => (await receipts()).requests.includes(`${origin}/pending`), { timeout: 30_000 })
      .toBe(true);
    await expect(chat.getByRole("status")).toHaveText("Agent is browsing…");
    await chat.getByRole("button", { name: "Stop browsing" }).click();
    await expect.poll(async () => (await session(stop)).turns.at(-1)?.stopReason).toBe("aborted");
    await expect.poll(async () => (await receipts()).aborted).toBeGreaterThan(0);
    await expect(origins).toHaveCount(0);
    await expect(current).toHaveCount(0);
    await expect(chat.getByRole("status")).toHaveText("No browser open");

    async function reopenSecond(message: string) {
      await select(second);
      await expect(current).toHaveCount(0);
      await expect(origins).toHaveCount(0);
      await grant();
      await send(message);
      await expect(current).toHaveText(`${origin}/agent-page`, { timeout: 40_000 });
      return (await inspect(second))?.pid;
    }
    const appOptOutPid = await reopenSecond("Open the browser before disabling VERA access");
    await settingsPage();
    await toggle(appOptIn, false);
    await expect(benchOptIn).toBeChecked();
    await expect.poll(() => allowed(second)).toEqual([]);
    await expect.poll(() => inspect(second)).toBe(null);
    await verifyNativeExit(appOptOutPid);
    await toggle(appOptIn, true);
    const workbenchOptOutPid = await reopenSecond("Open the browser before disabling workbench access");
    await settingsPage();
    await toggle(benchOptIn, false);
    await expect(appOptIn).toBeChecked();
    await expect.poll(() => allowed(second)).toEqual([]);
    await expect.poll(() => inspect(second)).toBe(null);
    await verifyNativeExit(workbenchOptOutPid);
    await toggle(benchOptIn, true);
    const removalPid = await reopenSecond("Open the browser before removing the runtime");
    await settingsPage();
    await settings.getByRole("button", { name: "Remove browser runtime" }).click();
    await expect(uiStatus).toHaveText("Browser runtime is not installed.", { timeout: 25_000 });
    await expect.poll(() => allowed(second)).toEqual([]);
    await expect.poll(() => inspect(second)).toBe(null);
    await verifyNativeExit(removalPid);
    await page.reload();
    await select(first);
    await expect(current).toHaveCount(0);
    await expect(origins).toHaveCount(0);
    expect(
      await page.evaluate(
        async ({ workbenchId, sessionId }) => {
          const { vera } = window as unknown as { vera: VeraBridge };
          return await vera.invoke("browser.session.get", { workbenchId, sessionId });
        },
        { workbenchId, sessionId: second },
      ),
    ).toMatchObject({ open: false, currentUrl: null, origins: [], failure: null });

    const network = await receipts();
    expect(network.requests).toEqual(
      expect.arrayContaining([
        `${origin}/agent-start`,
        `${origin}/agent-page`,
        `${origin}/agent-next`,
        final,
      ]),
    );
    expect(network.requests.every((url) => new URL(url).origin === origin)).toBe(true);
    const outbound = await outboundAttempts(instance);
    expect(outbound).toEqual([]);
    if (evidence)
      await writeFile(
        resolve(evidence),
        JSON.stringify(
          {
            platform: process.platform,
            packaged: Boolean(packaged),
            browser,
            windowsVerifiedProcessFlag: commandLine,
            network,
            outbound,
            terminatedBrowserPids: [secondPid, browser?.pid, appOptOutPid, workbenchOptOutPid, removalPid],
            complete: true,
          },
          null,
          2,
        ),
      );
  } finally {
    await app?.close();
    await rm(scratch, { recursive: true, force: true, maxRetries: 5 });
  }
});
