import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { channels } from "@vera/shared";
import { build } from "esbuild";

type Backend = typeof import("../../src/apps/desktop/src/main/terminal-pty.js") &
  typeof import("../../src/apps/desktop/src/main/terminals.js") &
  typeof import("../../src/libraries/core/src/plugins/node-process-host.js") &
  typeof import("../../src/libraries/core/src/plugins/shell.js");

import { expect, test } from "./fixtures.js";

const quote = (value: string) =>
  process.platform === "win32" ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\"'\"'")}'`;

test("real PTY and xterm replay history without injecting replies, while fresh VT queries still work", async ({
  page,
  rendererUrl,
}) => {
  test.setTimeout(90000);
  const evidence = resolve("evaluation-outputs/terminal-input-fix");
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(join(evidence, "pty-"));
  const bundle = join(root, "backend.mjs");
  await build({
    stdin: {
      contents: `
export { TerminalService } from './src/apps/desktop/src/main/terminals.ts';
export { createPtyFactory } from './src/apps/desktop/src/main/terminal-pty.ts';
export { NodeProcessHost } from './src/libraries/core/src/plugins/node-process-host.ts';
export { createCommandShellHost } from './src/libraries/core/src/plugins/shell.ts';
`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    packages: "external",
    outfile: bundle,
    alias: {
      "@vera/core": resolve("src/libraries/core/src/index.ts"),
      "@vera/shared": resolve("src/libraries/shared/src/index.ts"),
    },
  });
  const { TerminalService, createPtyFactory, NodeProcessHost, createCommandShellHost } = (await import(
    pathToFileURL(bundle).href
  )) as Backend;
  const helper = join(root, "query.cjs");
  await writeFile(
    helper,
    `
process.stdin.setRawMode(true);
let response = '';
process.stdin.on('data', bytes => {
 response += bytes;
 if (/\\x1b\\[\\?[0-9;]+c/.test(response)) {
  console.log('VT_QUERY_' + process.argv[2]); process.exit(0);
 }
});
process.stdout.write('\\x1b[c');
setTimeout(() => process.exit(2), 15000);
`,
  );
  const host = new NodeProcessHost(spawn);
  let owner = "";
  const replies: { id: string; data: string }[] = [];
  const service = new TerminalService({
    current: () => ({ id: owner, folder: root }),
    shell: createCommandShellHost(
      host,
      () => "",
      (text) => text,
    ),
    pty: createPtyFactory(host),
    scrub: (text) => text,
    maskUserOutput: () => false,
    secrets: () => [],
  });
  try {
    const outbound: string[] = [];
    await page.context().route("**/*", async (route) => {
      if (new URL(route.request().url()).hostname === "127.0.0.1") await route.continue();
      else {
        outbound.push(route.request().url());
        await route.abort();
      }
    });
    await page.exposeFunction("terminalReplayHost", async (channel: string, input: unknown) => {
      if (channel === "terminal.list") {
        const a = channels[channel].request.parse(input);
        owner ||= a.workbenchId;
        return service.list(a.workbenchId);
      }
      if (channel === "terminal.create") {
        const a = channels[channel].request.parse(input);
        return service.create(a.workbenchId, a.cols, a.rows);
      }
      if (channel === "terminal.output") {
        const a = channels[channel].request.parse(input);
        return service.output(a.workbenchId, a.id);
      }
      if (channel === "terminal.resize") {
        const a = channels[channel].request.parse(input);
        service.resize(a.workbenchId, a.id, a.cols, a.rows);
        return {};
      }
      if (channel === "terminal.input") {
        const a = channels[channel].request.parse(input);
        replies.push({ id: a.id, data: a.data });
        service.input(a.workbenchId, a.id, a.data);
        return {};
      }
      throw Error(`Unexpected terminal call: ${channel}`);
    });
    await page.route("**/api/index.ts*", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: `${await response.text()}
const replayOriginal = api.invoke.bind(api);
api.invoke = (channel, input) => channel.startsWith('terminal.')
 ? window.terminalReplayHost(channel, input) : replayOriginal(channel, input);
`,
      });
    });
    await page.goto(`${rendererUrl}/?mock=chat`);
    const showTerminal = async () => {
      await page.locator("[data-workbench-entry] .workbench-group-name").first().click();
      if (!(await page.locator("#tab-terminal").isVisible()))
        await page.locator('[data-toggle="right"]').click();
      await page.locator("#tab-terminal").click();
      await expect(page.locator(".terminal-surface textarea")).toBeAttached();
    };
    await showTerminal();
    await expect.poll(() => service.list(owner).length).toBe(1);
    const first = service.list(owner)[0];
    if (!first) throw Error("Missing terminal");
    const output = () => service.output(owner, first.id).output;
    const query = async (label: string) => {
      service.input(
        owner,
        first.id,
        `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} ${quote(helper)} ${label}\r`,
      );
      await expect.poll(output, { timeout: 20000 }).toContain(`VT_QUERY_${label}`);
    };
    await query("ONE");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: VT device replies are ESC-prefixed protocol data.
    const count = () => replies.filter((r) => r.id === first.id && /\x1b\[\?[0-9;]+c/.test(r.data)).length;
    const before = count();
    expect(before).toBeGreaterThan(0);
    await page.getByRole("button", { name: "New terminal", exact: true }).click();
    await expect.poll(() => service.list(owner).length).toBe(2);
    await page.locator(`#terminal-${first.id}`).click();
    await expect(page.locator(".xterm-rows")).toContainText("VT_QUERY_ONE");
    expect(count()).toBe(before);
    await page.reload();
    await showTerminal();
    await expect(page.locator(".xterm-rows")).toContainText("VT_QUERY_ONE");
    expect(count()).toBe(before);
    await query("TWO");
    expect(count()).toBe(before + 1);
    // Hiding selectors must only detach the view, never terminate its PTY or foreground program.
    const running = join(root, "running.cjs");
    await writeFile(running, "setInterval(() => console.log('HIDDEN_TAB_TICK'), 300);\n");
    service.input(
      owner,
      first.id,
      `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} ${quote(running)}\r`,
    );
    await expect.poll(output).toContain("HIDDEN_TAB_TICK");
    await page.locator('[data-action="edit-workbench-overview"]').click();
    await page.locator('[data-project-section="interface"]').click();
    await page.locator('[data-panel-tab-toggle="terminal"]').uncheck();
    await page.locator('[data-panel-tab-toggle="runs"]').uncheck();
    await page.locator("[data-project-save]").click();
    await expect(page.locator("#tab-terminal")).toHaveCount(0);
    await expect(page.locator("#tab-runs")).toHaveCount(0);
    const hiddenLength = output().length;
    await expect.poll(() => output().length).toBeGreaterThan(hiddenLength);
    expect(service.list(owner).find((terminal) => terminal.id === first.id)?.running).toBe(true);
    await page.keyboard.press("Control+Shift+T");
    await expect(page.locator("#tab-terminal")).toHaveCount(0);
    await page.locator("[data-configure-panel-tabs]").click();
    await page.locator("[data-restore-panel-tabs]").click();
    await page.locator("[data-project-save]").click();
    await page.locator("#tab-terminal").click();
    await expect(page.locator(".xterm-rows")).toContainText("HIDDEN_TAB_TICK");
    expect(service.list(owner)).toHaveLength(2);
    expect(output()).not.toContain("ParserError");
    expect(outbound).toEqual([]);
    await writeFile(
      join(evidence, "pty-replay-proof.json"),
      JSON.stringify(
        { platform: process.platform, before, after: count(), replies, output: output() },
        null,
        2,
      ),
    );
  } finally {
    await service.closeAll();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
