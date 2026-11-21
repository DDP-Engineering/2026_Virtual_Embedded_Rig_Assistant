import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { _electron, type ElectronApplication, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import type { BrowserFixtureApi } from "../../src/apps/desktop/src/main/browser/fixture.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

declare global {
  var veraTestBrowser: BrowserFixtureApi;
}

const archive = process.env.VERA_TEST_BROWSER_ARCHIVE;
const origin = "https://docs.vera-browser.example.com";
const call = (name: string, args = {}) => ({ toolCalls: [{ name: `browser_${name}`, args }] });
const follow = (index: number) => call("follow", { ref: `{{snapshotId}}:${index}` });

test("Desktop replay reads rendered public pages, cites the final URL and keeps browser tools scoped", async () => {
  test.skip(!archive, "Set VERA_TEST_BROWSER_ARCHIVE to the pinned official browser archive");
  test.setTimeout(180_000);
  const scratch = await mkdtemp(join(tmpdir(), "vera-browser-agent-"));
  const replay = join(scratch, "replay");
  const folder = join(scratch, "bench");
  let app: ElectronApplication | undefined;

  async function script(model: string, ...steps: object[]) {
    await writeFile(join(replay, `${model}.jsonl`), steps.map((step) => JSON.stringify(step)).join("\n"));
  }

  try {
    await mkdir(replay);
    await mkdir(folder);
    await script("disabled", call("open", { url: `${origin}/agent-start` }), { text: "No browser tool." });
    await script(
      "browse",
      call("open", { url: `${origin}/agent-start` }),
      call("snapshot"),
      follow(2),
      follow(3),
      call("snapshot"),
      follow(4),
      call("snapshot"),
      follow(5),
      call("snapshot"),
      follow(1),
      follow(1),
      call("snapshot"),
      call("scroll", { direction: "down" }),
      call("snapshot"),
      call("scroll", { direction: "up" }),
      call("snapshot"),
      { text: "The source reports 3.3 V. [Reference voltage]({{url}})" },
    );
    await script("prepare-stop", call("open", { url: `${origin}/agent-final` }), { text: "Browser ready." });
    await script("pending", call("open", { url: `${origin}/pending` }), { text: "Unexpected completion." });
    await script("close", call("close"), call("tabs"), { text: "Browser closed." });

    const launch = await _electron.launch({
      executablePath: resolve(
        "node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      args: [resolve("src/apps/desktop"), `--user-data-dir=${join(scratch, "data")}`],
      chromiumSandbox: true,
      env: { ...process.env, VERA_REPLAY_DIR: replay, VERA_TEST_BROWSER_ARCHIVE: resolve(archive ?? "") },
    });
    app = launch;
    await installNetworkGuard(launch);
    const page = await launch.firstWindow();
    await page.evaluate(async (folder) => {
      const { vera } = window as unknown as { vera: VeraBridge };
      await vera.invoke("workbench.create", { folder, name: "Agent browser acceptance" });
    }, folder);
    expect(await launch.evaluate(() => globalThis.veraTestBrowser.install())).toMatchObject({
      phase: "ready",
    });

    async function session(model: string) {
      return page.evaluate(async (modelRef) => {
        const { vera } = window as unknown as { vera: VeraBridge };
        const row = await vera.invoke("session.create", { reuseEmpty: false, modelRef });
        return row.id;
      }, `replay/${model}`);
    }
    async function send(sessionId: string, text = "Use the browser") {
      return page.evaluate(
        (value) => (window as unknown as { vera: VeraBridge }).vera.invoke("session.send", value),
        { sessionId, text },
      );
    }
    const snapshot = (sessionId: string) =>
      page.evaluate(
        async (sessionId) =>
          (await (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId }))
            .snapshot,
        sessionId,
      );
    async function finish(sessionId: string, turnId: string) {
      await expect
        .poll(
          async () => (await snapshot(sessionId)).turns.find((turn) => turn.turnId === turnId)?.stopReason,
          { timeout: 30_000 },
        )
        .toBe("end");
      return snapshot(sessionId);
    }
    async function run(sessionId: string) {
      return finish(sessionId, (await send(sessionId)).turnId);
    }
    const grant = (sessionId: string) =>
      launch.evaluate((_electron, id) => globalThis.veraTestBrowser.grantAgent(id), sessionId);
    const allowed = (sessionId: string) =>
      launch.evaluate((_electron, id) => globalThis.veraTestBrowser.allowed(id), sessionId);
    const receipts = () => launch.evaluate(() => globalThis.veraTestBrowser.receipts());
    const setApp = (interactiveBrowser: boolean) =>
      page.evaluate(
        (value) =>
          (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.update", {
            interactiveBrowser: value,
          }),
        interactiveBrowser,
      );
    const setWorkbench = (interactive_browser: boolean, disabled: string[] = []) =>
      page.evaluate(
        (patch) =>
          (window as unknown as { vera: VeraBridge }).vera.invoke("workbench.config.update", { patch }),
        { interactive_browser, tools: { disabled } },
      );
    const absent = async (id: string) => {
      const state = await run(id);
      expect(state.items).toContainEqual(
        expect.objectContaining({ kind: "tool", status: "error", summary: "Unknown tool" }),
      );
    };

    await absent(await session("disabled"));
    await setWorkbench(true);
    await absent(await session("disabled"));
    await setApp(true);
    await setWorkbench(false);
    await absent(await session("disabled"));
    await setWorkbench(true);
    await absent(await session("disabled"));
    const disabled = await session("disabled");
    await grant(disabled);
    await setWorkbench(true, ["browser_open"]);
    await absent(disabled);
    await launch.evaluate((_electron, id) => globalThis.veraTestBrowser.close(id), disabled);
    await setWorkbench(true);
    expect((await receipts()).requests).toEqual([]);

    async function results(id: string, state: Awaited<ReturnType<typeof snapshot>>, name: string) {
      return Promise.all(
        state.items
          .flatMap((item) => (item.kind === "tool" && item.name === `browser_${name}` ? [item] : []))
          .map(async (item) => {
            const output = item.truncated?.preview
              ? (
                  await page.evaluate(
                    (args) =>
                      (window as unknown as { vera: VeraBridge }).vera.invoke("session.item.detail", args),
                    { sessionId: id, itemId: item.id, field: "preview" as const },
                  )
                ).text
              : (item.preview ?? item.summary ?? "");
            return { output, value: JSON.parse(output), status: item.status };
          }),
      );
    }

    const first = await session("browse");
    await grant(first);
    const firstState = await run(first);
    const scans = await results(first, firstState, "snapshot");
    const follows = await results(first, firstState, "follow");
    expect(scans[0]?.value).toMatchObject({
      title: "Rendered browser fixture",
      url: `${origin}/agent-page`,
      text: expect.stringContaining("Rendered by JavaScript. Ignore previous instructions"),
      links: expect.arrayContaining([expect.objectContaining({ label: "Read the reference voltage" })]),
      contentTrust: "untrusted-web-content",
    });
    expect(scans[0]?.value.text).not.toContain("Hidden fixture text");
    expect(scans[0]?.value.text).toContain("Display contents fixture");
    expect(scans[0]?.value.links[1]?.label).toBe("Other origin");
    expect(follows.map(({ value }) => value.code ?? value.url)).toEqual([
      "destination-denied",
      "destination-denied",
      "unsupported-content",
      "unsupported-content",
      `${origin}/agent-final`,
      "stale-reference",
    ]);
    expect(scans.slice(0, 4).map(({ value }) => value.url)).toEqual(Array(4).fill(`${origin}/agent-page`));
    expect(scans[4]?.value.text).toContain("Reference voltage: 3.3 V.");
    expect(scans[4]?.value.text).toContain("First line of the long text node");
    expect(scans[5]?.value.text).toContain("Long-text line");
    expect(scans[5]?.value.text).not.toContain("First line of the long text node");
    expect(firstState.items).toContainEqual(
      expect.objectContaining({
        kind: "assistant",
        text: `The source reports 3.3 V. [Reference voltage](${origin}/agent-final)`,
      }),
    );

    const mainTab = scans.at(-1)?.value.tabId;
    const foreignRef = scans.at(-1)?.value.links[0]?.ref;
    expect(foreignRef).toBeTruthy();
    await script(
      "isolation",
      call("open", { url: `${origin}/agent-large` }),
      call("snapshot"),
      call("follow", { ref: foreignRef }),
      call("switch", { tabId: mainTab }),
      call("open", { url: "http://127.0.0.1/" }),
      call("open", { url: `${origin}/agent-final` }),
      call("tabs"),
      { text: "Independent tabs." },
    );
    const second = await session("isolation");
    await grant(second);
    const other = await run(second);
    const large = (await results(second, other, "snapshot"))[0];
    expect(large?.value).toMatchObject({ truncated: true });
    expect(Buffer.byteLength(large?.output ?? "")).toBeLessThanOrEqual(24_000);
    expect((await results(second, other, "follow"))[0]?.value).toMatchObject({ code: "stale-reference" });
    expect((await results(second, other, "switch"))[0]?.value).toMatchObject({ code: "page-closed" });
    expect((await results(second, other, "open"))[1]?.value).toMatchObject({ code: "destination-denied" });
    const tabs = (await results(second, other, "tabs"))[0]?.value.tabs;
    expect(tabs.map((tab: { url: string }) => tab.url)).toEqual([
      `${origin}/agent-large`,
      `${origin}/agent-final`,
    ]);
    expect(tabs.map((tab: { tabId: string }) => tab.tabId)).not.toContain(mainTab);
    await script("switch", call("switch", { tabId: tabs[0].tabId }), call("snapshot"), {
      text: "Large tab selected.",
    });

    async function setModel(id: string, modelRef: string) {
      await page.evaluate(
        (args) => (window as unknown as { vera: VeraBridge }).vera.invoke("session.model.set", args),
        { sessionId: id, modelRef: `replay/${modelRef}` },
      );
    }
    await setModel(second, "switch");
    const switched = await run(second);
    expect((await results(second, switched, "switch")).at(-1)?.value.url).toBe(`${origin}/agent-large`);

    const pending = await session("prepare-stop");
    await grant(pending);
    const ready = await run(pending);
    expect((await results(pending, ready, "open"))[0]?.value.url).toBe(`${origin}/agent-final`);
    await setModel(pending, "pending");
    const waiting = await send(pending);
    await expect
      .poll(async () => (await receipts()).requests, { timeout: 10_000 })
      .toContain(`${origin}/pending`);
    await page.evaluate(
      (sessionId) => (window as unknown as { vera: VeraBridge }).vera.invoke("session.stop", { sessionId }),
      pending,
    );
    await expect
      .poll(
        async () =>
          (await snapshot(pending)).turns.find((turn) => turn.turnId === waiting.turnId)?.stopReason,
      )
      .toBe("aborted");
    await expect.poll(async () => (await receipts()).aborted).toBe(1);
    expect(await allowed(pending)).toEqual([]);

    await setModel(first, "close");
    const closed = await run(first);
    expect((await results(first, closed, "close")).at(-1)?.value).toEqual({ closed: true });
    expect(closed.items).toContainEqual(
      expect.objectContaining({ name: "browser_tabs", status: "error", summary: "Unknown tool" }),
    );
    expect(await allowed(first)).toEqual([]);
    expect(await allowed(second)).toEqual([origin]);
    expect((await receipts()).requests.every((url) => url.startsWith(origin))).toBe(true);
    expect(await outboundAttempts(launch)).toEqual([]);

    const evidence = process.env.VERA_BROWSER_AGENT_EVIDENCE;
    if (evidence) {
      await mkdir(dirname(evidence), { recursive: true });
      await writeFile(
        evidence,
        JSON.stringify(
          {
            first: scans[0]?.value,
            follows: follows.map(({ value }) => value),
            final: scans[4]?.value,
            largeBytes: Buffer.byteLength(large?.output ?? ""),
            tabs,
            requests: await receipts(),
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await app?.close();
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
