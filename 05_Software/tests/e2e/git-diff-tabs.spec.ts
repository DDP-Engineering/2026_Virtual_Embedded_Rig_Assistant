// REQ-UX-c4e574c0 REQ-SEC-0634fcfa REQ-UX-a033771c REQ-SEC-5ac0eca4
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, type Page, test } from "@playwright/test";
import type { Channel, Request, Response, VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../../src/apps/desktop");

function invoke<C extends Channel>(page: Page, channel: C, request: Request<C>): Promise<Response<C>> {
  return page.evaluate(
    ({ channel, request }) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      return api.invoke(channel as never, request as never);
    },
    { channel, request },
  ) as Promise<Response<C>>;
}

test("native Git tabs share Chat and document navigation and reject a stale copied-workbench lease", async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(join(tmpdir(), "vera-git-tabs-"));
  const repository = join(root, "repository");
  const folder = join(repository, "bench");
  const copy = join(repository, "copy");
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = join(desktop, "../../../tests/fixtures/llm-scripts");
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=VERA", "-c", "user.email=test@example.invalid", ...args], {
      cwd: repository,
      env: {
        ...env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  let app: Awaited<ReturnType<typeof _electron.launch>> | undefined;
  try {
    await Promise.all([mkdir(folder, { recursive: true }), mkdir(join(copy, ".vera"), { recursive: true })]);
    const name = "[compare].txt";
    const changed = join(folder, name);
    await Promise.all([
      writeFile(changed, "base version\n"),
      writeFile(join(copy, name), "copied base\n"),
      writeFile(join(folder, "gone.txt"), "deleted line\n"),
      writeFile(join(folder, "replacement"), "previous file\n"),
      copyFile(join(desktop, "../../../tests/fixtures/documents/pages.pdf"), join(folder, "paper.pdf")),
    ]);
    git("init", "-b", "main");
    git("add", "copy");
    git("commit", "-m", "Copy-only history");
    git("add", "bench");
    git("commit", "-m", "Workbench history");
    await writeFile(join(folder, "untracked.txt"), "ordinary file");
    await writeFile(changed, "staged version\n");
    git("--literal-pathspecs", "add", "--", `bench/${name}`);
    await writeFile(changed, "working version\n");
    await writeFile(join(copy, name), "copied worktree only\n");
    await rm(join(folder, "gone.txt"));
    await rm(join(folder, "replacement"));
    await mkdir(join(folder, "replacement"));
    await writeFile(join(folder, "replacement", "child"), "new staged child\n");
    git("add", "-A", "bench/replacement");

    app = await _electron.launch({
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
    await page.waitForFunction(() => !!(window as unknown as { vera?: VeraBridge }).vera);
    const original = await invoke(page, "workbench.create", {
      folder,
      name: "Git fixture",
      config: { interface: { git_status: true }, docs: { include: ["paper.pdf"], exclude: [] } },
    });
    await copyFile(join(folder, ".vera", "workbench.yaml"), join(copy, ".vera", "workbench.yaml"));
    await expect
      .poll(
        async () =>
          (await invoke(page, "docs.list", { workbenchId: original.config.id })).documents.find(
            (doc) => doc.path === "paper.pdf",
          )?.status,
        { timeout: 30_000 },
      )
      .toBe("indexed");
    await page.reload();
    await page.locator('[data-action="new-session"]').click();
    const composer = page.getByRole("textbox", { name: "Message", exact: true });
    await expect(composer).toBeEnabled();
    const sessionId = (await page
      .locator('[data-session][aria-current="page"]')
      .getAttribute("data-session")) as string;
    await invoke(page, "session.model.set", { sessionId, modelRef: "replay/ui-slow" });
    await invoke(page, "session.send", {
      sessionId,
      text: Array.from({ length: 90 }, (_, index) => `Long conversation line ${index + 1}`).join("\n\n"),
    });
    await expect(page.locator('[data-message-kind="assistant"]')).toContainText("SLOW END");
    await expect
      .poll(async () => (await invoke(page, "session.get", { sessionId })).snapshot.activeTurnId)
      .toBeNull();

    await page.locator('[data-toggle="right"]').click();
    await page.locator("#tab-docs").click();
    const docs = page.locator("#panel-docs");
    const row = (path: string) => docs.locator(`[data-tree-path="${path}"]`);
    const transcript = page.locator("[data-transcript]");
    const draft = "Keep this exact draft\nwith its second line.";
    await composer.fill(draft);
    const scroll = await transcript.evaluate((node) => {
      node.scrollTop = 172;
      return node.scrollTop;
    });
    expect(scroll).toBe(172);
    const center = page.locator("[data-source-current]");
    const strip = page.locator("[data-document-tabs]");
    const selected = strip.locator('[role="tab"][aria-selected="true"]');
    const menu = docs.locator("[data-tree-menu]");
    async function openDiff(path: string, comparison: "staged" | "unstaged") {
      await row(path).focus();
      await page.keyboard.press("Shift+F10");
      await page.keyboard.press("End");
      await expect(menu.getByRole("menuitem", { name: "Git", exact: true })).toBeFocused();
      await page.keyboard.press("ArrowRight");
      if (comparison === "staged" && (await menu.locator('[data-menu-action="git-diff-unstaged"]').count()))
        await page.keyboard.press("ArrowDown");
      await expect(menu.locator(`[data-menu-action="git-diff-${comparison}"]`)).toBeFocused();
      await page.keyboard.press("Enter");
    }
    async function openGitMenu(path: string) {
      await row(path).focus();
      await page.keyboard.press("Shift+F10");
      const submenu = menu.getByRole("menuitem", { name: "Git", exact: true });
      await expect(submenu).toBeVisible();
      await page.keyboard.press("End");
      await expect(submenu).toBeFocused();
      await page.keyboard.press("ArrowRight");
    }
    async function openHistory(path: string) {
      await openGitMenu(path);
      const item = menu.getByRole("menuitem", { name: "View file history" });
      await expect(item).toBeVisible();
      await page.keyboard.press("End");
      await expect(item).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(selected).toHaveText("History: " + path);
      await expect(center.getByRole("region", { name: "View file history" })).toContainText(
        "Workbench history",
      );
    }
    await expect(row(name).locator("[data-git-badge]")).toHaveCount(2);
    await row(name).press("Enter");
    await expect(center).toContainText("working version");
    await row("paper.pdf").press("Enter");
    await expect(center.locator(".pdf-viewer")).toHaveAttribute("data-ready", "true");
    await openDiff(name, "unstaged");
    await expect(selected).toHaveText(`Unstaged: ${name}`);
    await expect(center).toContainText("working tree vs index");
    await expect(center.locator("pre")).toContainText("-staged version\n+working version");
    await openDiff(name, "staged");
    await expect(selected).toHaveText(`Staged: ${name}`);
    await expect(center).toContainText("index vs HEAD");
    await expect(center.locator("pre")).toContainText("-base version\n+staged version");
    await expect(docs.locator(".patch-document")).toHaveCount(0);
    await expect(strip.getByRole("tab")).toHaveText([
      "Chat",
      name,
      "paper.pdf",
      `Unstaged: ${name}`,
      `Staged: ${name}`,
    ]);
    await page.keyboard.press("Control+Shift+PageUp");
    await expect(strip.getByRole("tab").nth(3)).toHaveText(`Staged: ${name}`);
    await page.keyboard.press("Control+PageDown");
    await expect(selected).toHaveText(`Unstaged: ${name}`);
    await openDiff(name, "staged");
    await expect(strip.getByRole("tab")).toHaveCount(5);
    await expect(selected).toHaveText(`Staged: ${name}`);
    await page.keyboard.press("Control+w");
    await expect(strip.getByRole("tab")).toHaveCount(4);
    await openDiff(name, "staged");
    await expect(center.locator("pre")).toContainText("+staged version");
    await openHistory(name);
    await expect(strip.getByRole("tab")).toHaveText([
      "Chat",
      name,
      "paper.pdf",
      "Unstaged: " + name,
      "Staged: " + name,
      "History: " + name,
    ]);
    await page.keyboard.press("Control+PageDown");
    await expect(selected).toHaveText("Chat");
    await expect(composer).toHaveValue(draft);
    expect(await transcript.evaluate((node) => node.scrollTop)).toBe(scroll);
    await page.keyboard.press("Control+PageDown");
    await expect(selected).toHaveText(name);
    await page.keyboard.press("Control+PageDown");
    await expect(selected).toHaveText("paper.pdf");
    await openHistory(name);
    await expect(strip.getByRole("tab")).toHaveCount(6);
    await page.keyboard.press("Control+w");
    await expect(strip.getByRole("tab")).toHaveCount(5);
    await openHistory("paper.pdf");
    await page.keyboard.press("Control+w");
    await row("untracked.txt").focus();
    await page.keyboard.press("Shift+F10");
    await expect(menu.getByRole("menuitem", { name: "Open", exact: true })).toBeFocused();
    const untracked = await invoke(page, "git.historyEligibility", {
      workbenchId: original.config.id,
      indexLease: original.indexLease,
      path: "untracked.txt",
    });
    expect(untracked.eligibility).toBe("untracked");
    await expect(menu.getByRole("menuitem", { name: "Git", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await openHistory("gone.txt");
    await page.keyboard.press("Control+w");
    await openDiff("gone.txt", "unstaged");
    await expect(center.locator("pre")).toContainText("-deleted line");
    await openDiff("replacement", "staged");
    await expect(center.locator("pre")).toContainText("-previous file");
    await expect(center).not.toContainText("new staged child");
    await page.keyboard.press("Control+PageDown");
    await expect(selected).toHaveText("Chat");
    await expect(composer).toHaveValue(draft);
    expect(await transcript.evaluate((node) => node.scrollTop)).toBe(scroll);

    await openHistory(name);
    await invoke(page, "workbench.close", {});
    const next = await invoke(page, "workbench.open", { folder: copy });
    expect(next.config.id).toBe(original.config.id);
    expect(next.indexLease).not.toBe(original.indexLease);
    const gitTabs = page.locator('[data-document-tabs] [data-tab-key^="git-diff:"]');
    await expect(gitTabs).toHaveCount(0);
    await expect(page.locator('[data-document-tabs] [data-tab-key^="git-history:"]')).toHaveCount(0);
    const old = {
      workbenchId: original.config.id,
      indexLease: original.indexLease,
      path: name,
      comparison: "unstaged",
    } as const;
    const staleCode = await page.evaluate(async (request) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      try {
        await api.invoke("git.diff", request);
        return "accepted";
      } catch (error) {
        return (error as { code?: string }).code;
      }
    }, old);
    expect(staleCode).toBe("CONFLICT");
    const result = await invoke(page, "git.diff", { ...old, indexLease: next.indexLease });
    expect(result.result).toMatchObject({
      state: "patch",
      patch: expect.stringContaining("+copied worktree only"),
    });
    expect(JSON.stringify(result)).not.toContain("working version");
    const historyRequest = { workbenchId: old.workbenchId, indexLease: old.indexLease, path: old.path };
    const historyCode = await page.evaluate(async (request) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      try {
        await api.invoke("git.history", request);
        return "accepted";
      } catch (error) {
        return (error as { code?: string }).code;
      }
    }, historyRequest);
    expect(historyCode).toBe("CONFLICT");
    const history = await invoke(page, "git.history", { ...historyRequest, indexLease: next.indexLease });
    expect(history.result).toMatchObject({ state: "ready", commits: [{ subject: "Copy-only history" }] });
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
