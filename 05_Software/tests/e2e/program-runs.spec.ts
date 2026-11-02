// REQ-FUNC-83ad0f58: native Electron run of the echo-tools fixture plugin through the approval card.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, type Page, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "../../src/apps/desktop");
const plugin = join(here, "../fixtures/plugins/echo-tools");

async function launch(root: string, folder: string) {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VERA_TEST_ALLOW_WRITES;
  env.VERA_REPLAY_DIR = join(here, "../fixtures/llm-scripts");
  env.VERA_TEST_DIALOG_PATH = folder;
  // Provisioning is PLG-05: the instrumented build runs the fixture program with this Node.
  env.VERA_TEST_PROGRAMS = JSON.stringify({ "echo-tools/echo": { executable: process.execPath } });
  const app = await _electron.launch({
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
  return app;
}
const invoke = <T>(page: Page, channel: string, payload: unknown) =>
  page.evaluate(
    async ({ channel, payload }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, payload as never),
    { channel, payload },
  ) as Promise<T>;
type Snapshot = {
  snapshot: {
    turns: { stopReason?: string | null }[];
    approvals: { decision: string | null }[];
    items: { kind: string; name?: string; status?: string; summary?: string }[];
  };
};

test("an approved run_program card runs the real program and a denied one runs nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-program-runs-")),
    folder = join(root, "Board");
  await mkdir(join(folder, "build"), { recursive: true });
  await writeFile(join(folder, "build/app.bin"), "image");
  const app = await launch(root, folder),
    page = await app.firstWindow();
  try {
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("#workbench-name").fill("Board");
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    const { config } = await invoke<{ config: { id: string } }>(page, "workbench.config.get", {});
    await invoke(page, "plugins.install", { path: plugin });
    await invoke(page, "plugins.toggle", { workbenchId: config.id, id: "echo-tools", enabled: true });
    await page.locator('[data-action="new-session"]').click();
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await expect(input).toBeEnabled();
    const id = (await page
      .locator('[data-session][aria-current="page"]')
      .getAttribute("data-session")) as string;
    await invoke(page, "session.model.set", { sessionId: id, modelRef: "replay/program-write" });
    const get = () => invoke<Snapshot>(page, "session.get", { sessionId: id });

    await input.fill("Flash the board");
    await input.press("Enter");
    const card = page.locator("[data-approval-card].program-approval");
    await expect(card).toBeVisible();
    await expect(card.locator("[data-approval-command]")).toContainText("echo write build/app.bin");
    await expect(card).toContainText(createHash("sha256").update("image").digest("hex"));
    await card.getByRole("button", { name: "Approve", exact: true }).click();
    await expect.poll(async () => (await get()).snapshot.turns.at(-1)?.stopReason).toBe("end");
    const run = (await get()).snapshot.items.find(
      (item) => item.kind === "tool" && item.name === "run_program",
    );
    expect(run?.status).toBe("ok");
    const result = JSON.parse(run?.summary ?? "{}") as {
      exitCode: number;
      output: string;
      log: string;
      risk: string;
    };
    expect(result).toMatchObject({ exitCode: 0, risk: "device-write" });
    expect(JSON.parse(result.output)).toMatchObject({ command: "write", args: ["build/app.bin"] });
    const logs = await readdir(join(folder, ".vera/runs"));
    expect(logs).toContain(result.log.split("/").at(-1));

    await input.fill("Flash it again");
    await input.press("Enter");
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Deny", exact: true }).click();
    await expect.poll(async () => (await get()).snapshot.turns.at(-1)?.stopReason).toBe("end");
    expect((await get()).snapshot.approvals.map((approval) => approval.decision)).toEqual([
      "approved",
      "denied",
    ]);
    expect(await readdir(join(folder, ".vera/runs"))).toHaveLength(logs.length);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
