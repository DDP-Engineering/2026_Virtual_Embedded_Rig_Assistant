import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, type Page, test } from "@playwright/test";
import { builtinToolNames, type ProgramRunInfo, type Response, type VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const invoke = <T>(page: Page, channel: string, payload: unknown) =>
  page.evaluate(
    async ({ channel, payload }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, payload as never),
    { channel, payload },
  ) as Promise<T>;

test("native Bypass edits and runs in a sibling repository, exports absolute paths and revokes background runs", async () => {
  test.setTimeout(60000);
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "vera-byp01-native-")));
  const bench = join(scratch, "first-repo"),
    outside = join(scratch, "second-repo"),
    scripts = join(scratch, "scripts");
  for (const folder of [bench, outside, scripts]) await mkdir(folder);
  for (const folder of [bench, outside]) execFileSync("git", ["init", folder], { stdio: "pipe" });
  const file = join(outside, "input.txt");
  const directoryAlias = join(bench, "sibling-alias");
  await symlink(outside, directoryAlias, process.platform === "win32" ? "junction" : "dir");
  await writeFile(file, "original sibling bytes\n");
  const steps = [
    { match: "Edit and run sibling", toolCalls: [{ name: "read", args: { path: file } }] },
    { toolCalls: [{ name: "edit", args: { path: file, oldString: "original", newString: "edited" } }] },
    {
      toolCalls: [
        {
          name: "run_program",
          args: {
            program: "echo",
            cwd: outside,
            args: ["write", "input.txt", `--directory=${directoryAlias}`],
          },
        },
      ],
    },
    { text: "Sibling edit and run completed" },
    {
      match: "Start sibling background",
      toolCalls: [
        {
          name: "run_program",
          args: { program: "echo", cwd: outside, args: ["serve", directoryAlias], background: true },
        },
      ],
    },
    { text: "Sibling background started" },
    {
      match: "Try outside in Ask",
      toolCalls: [
        { name: "run_program", args: { program: "echo", cwd: outside, args: ["write", "input.txt"] } },
      ],
    },
    { text: "Outside attempt ended" },
  ];
  for (const [name, rows] of [
    ["sibling", steps.slice(0, 4)],
    ["background", steps.slice(4, 6)],
    ["refused", steps.slice(6)],
  ] as const)
    await writeFile(join(scripts, `${name}.jsonl`), rows.map((step) => JSON.stringify(step)).join("\n"));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = scripts;
  env.VERA_TEST_DIALOG_PATH = bench;
  env.VERA_TEST_PROGRAMS = JSON.stringify({ "echo-tools/echo": { executable: process.execPath } });
  const app = await _electron.launch({
    executablePath: resolve(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    args: [resolve("src/apps/desktop"), `--user-data-dir=${join(scratch, "profile")}`],
    chromiumSandbox: true,
    env,
  });
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("#workbench-name").fill("Sibling acceptance");
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    const plugin = resolve("tests/fixtures/plugins/echo-tools");
    const { sha256 } = await invoke<{ sha256: string }>(page, "plugins.review", { path: plugin });
    await invoke(page, "plugins.install", { path: plugin, sha256 });
    const { config } = await invoke<{ config: { id: string } }>(page, "workbench.config.get", {});
    await invoke(page, "plugins.toggle", { workbenchId: config.id, id: "echo-tools", enabled: true });
    await invoke(page, "workbench.config.update", {
      patch: {
        tools: {
          disabled: builtinToolNames.filter((name) => !["read", "edit", "run_program"].includes(name)),
        },
      },
    });
    await page.locator('[data-action="new-session"]').click();
    const id = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    if (!id) throw Error("Missing session");
    await invoke(page, "session.model.set", { sessionId: id, modelRef: "replay/sibling" });
    const picker = page.locator(".composer [data-permission-picker]");
    await picker.selectOption("bypass");
    await page.locator('[data-action="confirm-bypass"]').click();
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    const send = async (message: string, response: string) => {
      await input.fill(message);
      await input.press("Enter");
      await expect(page.locator("[data-transcript]")).toContainText(response);
      await expect(input).toBeEnabled();
    };
    await send("Edit and run sibling", "Sibling edit and run completed");
    expect(await readFile(file, "utf8")).toBe("edited sibling bytes\n");
    const view = await invoke<Response<"session.get">>(page, "session.get", { sessionId: id });
    const tool = view.snapshot.items.find((item) => item.kind === "tool" && item.name === "run_program");
    expect(tool).toMatchObject({ status: "ok" });
    if (tool?.kind !== "tool" || tool.summary === undefined) throw Error("Missing program result");
    const result = JSON.parse(tool.summary);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output)).toMatchObject({
      cwd: outside,
      args: ["input.txt", `--directory=${directoryAlias}`],
    });
    expect(result.log).toMatch(/^\.vera\/runs\//);
    await stat(join(bench, result.log));
    await expect(stat(join(outside, ".vera"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(view.snapshot.approvals.find((approval) => approval.program)?.program).toMatchObject({
      cwd: outside.replaceAll("\\", "/"),
      files: [{ arg: 1, path: file.replaceAll("\\", "/") }],
      directories: [{ arg: 2, path: outside.replaceAll("\\", "/") }],
    });
    await expect(page.locator("[data-approval-directories]")).toContainText(outside.replaceAll("\\", "/"));
    for (const format of ["json", "md"] as const) {
      const destination = join(scratch, `export.${format}`);
      await app.evaluate((_electron, path) => {
        process.env.VERA_TEST_DIALOG_PATH = path;
      }, destination);
      expect(await invoke(page, "session.export", { sessionId: id, format })).toEqual({ exported: true });
      const exported = await readFile(destination, "utf8");
      expect(exported).toContain(outside.replaceAll("\\", "/"));
      expect(exported).toContain(file.replaceAll("\\", "/"));
    }
    await invoke(page, "session.model.set", { sessionId: id, modelRef: "replay/background" });
    await send("Start sibling background", "Sibling background started");
    const safeView = await invoke<Response<"session.get">>(page, "session.get", { sessionId: id });
    expect(safeView.snapshot.approvals).toHaveLength(view.snapshot.approvals.length);
    for (const format of ["json", "md"] as const) {
      const destination = join(scratch, `safe-export.${format}`);
      await app.evaluate((_electron, path) => {
        process.env.VERA_TEST_DIALOG_PATH = path;
      }, destination);
      await invoke(page, "session.export", { sessionId: id, format });
      const text = await readFile(destination, "utf8");
      if (format === "json") {
        const data = JSON.parse(text);
        expect(
          data.events.find(
            (row: { event: { type: string; program?: { risk: string } } }) =>
              row.event.type === "tool.done" && row.event.program?.risk === "safe",
          )?.event.program,
        ).toMatchObject({
          cwd: outside.replaceAll("\\", "/"),
          directories: [{ arg: 1, path: outside.replaceAll("\\", "/") }],
        });
      } else {
        expect(text).toContain("## Program paths");
        expect(text).toContain(outside.replaceAll("\\", "/"));
      }
    }
    const runs = async () =>
      (await invoke<{ runs: ProgramRunInfo[] }>(page, "runs.list", { workbenchId: config.id })).runs;
    await expect.poll(async () => (await runs()).some((run) => run.state === "running")).toBe(true);
    await picker.selectOption("ask");
    await expect
      .poll(async () => (await runs()).find((run) => run.background)?.state, { timeout: 15000 })
      .toBe("stopped");
    await invoke(page, "session.model.set", { sessionId: id, modelRef: "replay/refused" });
    await send("Try outside in Ask", "Outside attempt ended");
    const refused = await invoke<Response<"session.get">>(page, "session.get", { sessionId: id });
    expect(
      refused.snapshot.items.filter((item) => item.kind === "tool" && item.name === "run_program").at(-1),
    ).toMatchObject({ status: "error" });
    expect(await runs()).toHaveLength(2);
    expect(await outboundAttempts(app)).toEqual([]);
    if (process.env.VERA_BYP01_EVIDENCE_DIR) {
      const evidence = process.env.VERA_BYP01_EVIDENCE_DIR;
      await mkdir(evidence, { recursive: true });
      for (const format of ["json", "md"])
        await cp(join(scratch, `export.${format}`), join(evidence, `export.${format}`));
      for (const format of ["json", "md"])
        await cp(join(scratch, `safe-export.${format}`), join(evidence, `safe-export.${format}`));
      await cp(join(bench, ".vera/runs"), join(evidence, "runs"), { recursive: true });
      await writeFile(join(evidence, "snapshot.json"), JSON.stringify(refused, null, 2));
      await page.screenshot({ path: join(evidence, "native.png") });
    }
  } finally {
    await app.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
