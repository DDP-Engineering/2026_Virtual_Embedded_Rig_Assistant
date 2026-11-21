import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, type Page, test } from "@playwright/test";
import type { DocumentIndexStatus, VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

type IndexRequest = { type: string; root?: string; input?: { root: string; path?: string } };
type Held = { seen: number; resume: (() => void)[] };
type IndexProof = { held: Map<string, Held>; events: DocumentIndexStatus[] };

async function send(page: Page, model: string, question: string) {
  const selected = '[data-session][aria-current="page"]';
  const previous = await page
    .locator(selected)
    .getAttribute("data-session", { timeout: 1000 })
    .catch(() => null);
  await page.locator('[data-action="new-session"]').click();
  await page.waitForFunction(
    ({ selected, previous }) => {
      const id = document.querySelector(selected)?.getAttribute("data-session");
      return id && id !== previous;
    },
    { selected, previous },
  );
  const id = await page.locator(selected).getAttribute("data-session");
  if (!id) throw Error("No selected session");
  await page.evaluate(
    ({ id, model }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("session.model.set", {
        sessionId: id,
        modelRef: `replay/${model}`,
      }),
    { id, model },
  );
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await input.fill(question);
  await input.press("Enter");
  return id;
}

test("native sidebar, late Files and replay track live indexing and saved retrieval independently", async () => {
  test.setTimeout(150000);
  const root = await mkdtemp(join(tmpdir(), "vera-index-status-"));
  const folder = join(root, "board");
  const second = join(root, "empty");
  const scripts = join(root, "replay");
  await Promise.all([mkdir(join(folder, "docs"), { recursive: true }), mkdir(second), mkdir(scripts)]);
  await Promise.all(
    Array.from({ length: 24 }, (_, i) =>
      writeFile(
        join(folder, "docs", `${String(i).padStart(2, "0")}.txt`),
        `Signal board ${i}. Coolant sensor ${i}.
`,
      ),
    ),
  );
  const script = (name: string, steps: object[]) =>
    writeFile(join(scripts, `${name}.jsonl`), steps.map((step) => JSON.stringify(step)).join("\n"));
  const search = (query: string) => ({
    toolCalls: [{ name: "search_docs", args: { query, mode: "keyword", k: 1 } }],
  });
  await script("empty-partial", [search("remote temperature"), { text: "No indexed match yet." }]);
  await script("partial", [
    {
      toolCalls: [
        {
          name: "search_docs",
          args: {
            query: "coolant",
            mode: "hybrid",
            pathGlob: "docs/00.txt",
            k: 1,
          },
        },
      ],
    },
    { text: "The sensor is documented [[docs/00.txt#L1-L1]]." },
  ]);
  await script("ordinary", [{ text: "The ordinary reply completed." }]);
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  env.VERA_REPLAY_DIR = scripts;
  const app = await _electron.launch({
    executablePath: resolve(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    chromiumSandbox: true,
    args: [
      resolve(process.env.VERA_BUILD_ROOT ?? "src/apps/desktop/out", "main/index.js"),
      `--user-data-dir=${join(root, "profile")}`,
    ],
    env,
  });
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await app.evaluate(({ BrowserWindow, utilityProcess }, folder) => {
      const proof: IndexProof = {
        held: new Map([
          ["select", { seen: 0, resume: [] }],
          ["docs/01.txt", { seen: 0, resume: [] }],
          ["docs/02.txt", { seen: 0, resume: [] }],
          ["rank", { seen: 0, resume: [] }],
        ]),
        events: [],
      };
      Object.assign(globalThis, { indexProof: proof });
      const fork = utilityProcess.fork.bind(utilityProcess);
      utilityProcess.fork = (...args: Parameters<typeof utilityProcess.fork>) => {
        const worker = fork(...args);
        const post = worker.postMessage.bind(worker);
        worker.postMessage = (message: IndexRequest, transfer) => {
          const key =
            message.type === "select" || message.type === "rank"
              ? message.type
              : message.type === "process"
                ? message.input?.path
                : undefined;
          const gate =
            (message.input?.root ?? message.root) === folder && key ? proof.held.get(key) : undefined;
          if (!gate) return post(message, transfer);
          gate.seen++;
          gate.resume.push(() => post(message, transfer));
        };
        return worker;
      };
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      if (!contents) throw Error("Missing renderer");
      const deliver = contents.send.bind(contents);
      contents.send = (channel, ...args) => {
        if (channel === "vera:event" && args[0]?.event?.type === "index.status")
          proof.events.push(args[0].event.status);
        deliver(channel, ...args);
      };
    }, folder);
    const hold = (key: string) =>
      app.evaluate((_electron, key) => {
        const proof = (globalThis as unknown as { indexProof: IndexProof }).indexProof;
        proof.held.set(key, { seen: 0, resume: [] });
      }, key);
    const blocked = (key: string) =>
      app.evaluate(
        (_electron, key) =>
          (globalThis as unknown as { indexProof: IndexProof }).indexProof.held.get(key)?.seen ?? 0,
        key,
      );
    const release = (key: string) =>
      app.evaluate((_electron, key) => {
        const proof = (globalThis as unknown as { indexProof: IndexProof }).indexProof;
        const gate = proof.held.get(key);
        proof.held.delete(key);
        for (const resume of gate?.resume ?? []) resume();
      }, key);
    const create = (folder: string, name: string) =>
      page.evaluate(
        ({ folder, name }) =>
          (window as unknown as { vera: VeraBridge }).vera.invoke("workbench.create", { folder, name }),
        { folder, name },
      );
    await create(second, "Empty bench");
    const first = await create(folder, "Indexed bench");
    await page.reload();
    const badge = page.locator(".workbench-index-status");
    const files = page.locator('[role="tabpanel"] .docs-index-status');
    await expect.poll(() => blocked("select")).toBe(1);
    await expect(badge).toHaveAttribute("data-index-state", "scanning");
    await expect(badge).toHaveAccessibleName(/Scanning documents.*Open Files/);
    await expect(files).toHaveCount(0);

    await send(page, "empty-partial", "Search before the first publication");
    await expect(page.locator("[data-transcript]")).toContainText("No indexed match yet.");
    await expect(page.locator("[data-retrieval-notice]")).toContainText("Pending or excluded sources");
    await expect(page.locator("[data-retrieval-notice]")).toContainText("no searchable passages");

    await release("select");
    await expect.poll(() => blocked("docs/01.txt"), { timeout: 45000 }).toBe(1);
    await expect(badge).toHaveAttribute("data-index-state", "indexing");
    await expect(badge).toHaveAccessibleDescription(/1 of 24 processed.*1 searchable/);
    const name = page.locator(".workbench-group-name", { hasText: "Indexed bench" });
    await name.focus();
    await page.keyboard.press("Tab");
    await expect(badge).toBeFocused();
    await expect(badge.locator(".workbench-index-tooltip")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "Files" })).toBeFocused();
    await expect(files).toContainText("1 of 24 processed");
    await expect(files).toContainText("1 searchable");
    expect(
      await page.locator(".docs-indexing").evaluate((icon) => getComputedStyle(icon).animationName),
    ).toBe("none");

    const partial = await send(page, "partial", "Find the coolant sensor");
    await expect.poll(() => blocked("rank")).toBe(1);
    await release("docs/01.txt");
    await expect.poll(() => blocked("docs/02.txt")).toBe(1);
    await release("rank");
    await expect(page.locator("[data-transcript]")).toContainText("The sensor is documented");
    await expect(page.locator("[data-retrieval-notice]")).toContainText("used part of the index");
    await expect(page.locator('[data-citation="valid"]')).toHaveAttribute("title", "docs/00.txt#L1-L1");
    const notice = await page.locator("[data-retrieval-notice]").textContent();

    await send(page, "ordinary", "Chat during indexing");
    await expect(page.locator("[data-transcript]")).toContainText("The ordinary reply completed.");
    await expect(page.locator("[data-retrieval-notice]")).toHaveCount(0);
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await input.fill("Unsent while indexing");
    await hold("select");
    await writeFile(join(folder, "docs/queued.txt"), "Queued knowledge.");
    await release("docs/02.txt");
    await expect.poll(() => blocked("select"), { timeout: 60000 }).toBeGreaterThan(0);
    await expect(badge).toHaveAttribute("data-index-state", "scanning");
    const premature = await app.evaluate(() =>
      (globalThis as unknown as { indexProof: IndexProof }).indexProof.events.some(
        ({ state }) => state === "ready",
      ),
    );
    expect(premature).toBe(false);
    await expect(input).toHaveValue("Unsent while indexing");
    await release("select");
    await expect(badge).toHaveAttribute("data-index-state", "ready", { timeout: 45000 });
    await expect(badge).toHaveAccessibleDescription(/25 of 25 processed.*25 searchable/);
    await page.locator(`[data-session="${partial}"]`).click();
    await expect(page.locator("[data-retrieval-notice]")).toHaveText(notice ?? "");

    await page.locator(".workbench-group-name", { hasText: "Empty bench" }).click();
    await expect(badge).toHaveAttribute("data-index-state", "empty", { timeout: 10000 });
    await name.click();
    await expect(badge).toHaveAttribute("data-index-state", "ready", { timeout: 10000 });
    await app.evaluate(({ BrowserWindow }, oldLease) => {
      const proof = (globalThis as unknown as { indexProof: IndexProof }).indexProof;
      const old = proof.events.find(
        ({ indexLease, state }) => indexLease === oldLease && state === "scanning",
      );
      if (!old) throw Error("Expected a snapshot for the first lease");
      BrowserWindow.getAllWindows()[0]?.webContents.send("vera:event", {
        topic: "workbench",
        id: old.workbenchId,
        event: {
          type: "index.status",
          status: {
            ...old,
            revision: Number.MAX_SAFE_INTEGER,
          },
        },
      });
    }, first.indexLease);
    await expect(badge).toHaveAttribute("data-index-state", "ready");
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
