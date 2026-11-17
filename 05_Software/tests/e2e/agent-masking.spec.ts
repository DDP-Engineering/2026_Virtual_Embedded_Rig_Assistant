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

test("Agent and exports choices independently govern stored-secret replay disclosure and native exports", async () => {
  test.setTimeout(120000);
  const evidence = resolve("evaluation-outputs/mask04/native");
  await mkdir(evidence, { recursive: true });
  const scratch = await realpath(await mkdtemp(join(evidence, "owned-")));
  const secret = "mask04-native-mqtt-secret";
  const folder = join(scratch, "bench"),
    other = join(scratch, "other"),
    scripts = join(scratch, "scripts");
  for (const path of [folder, other, scripts]) await mkdir(path);
  await writeFile(join(folder, "input.txt"), `password=${secret}`);
  await writeFile(
    join(scripts, "mask.jsonl"),
    [
      { toolCalls: [{ name: "read", args: { path: "input.txt" } }] },
      { toolCalls: [{ name: "artifact_save", args: { name: "report.txt", content: secret } }] },
      { text: `Answer ${secret}` },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n"),
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
  const receipts: unknown[] = [];
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await invoke(page, "app.settings.update", { language: "en" });
    const bench = await invoke(page, "workbench.create", { folder, name: "Agent masking" });
    expect(
      (await invoke(page, "mqtt.credentials.save", { ref: "mask04", password: secret, storageConsent: true }))
        .status,
    ).toBe("saved");
    const setApp = (agent: boolean, exports: boolean) =>
      invoke(page, "app.settings.update", {
        privacy: { mask: { agent, exports, display: false, runs: false } },
      });
    const run = async (masked: boolean) => {
      const session = await invoke(page, "session.create", {
        workbenchId: bench.config.id,
        modelRef: "replay/mask",
        mode: "ask",
      });
      await page.evaluate((id) => {
        const api = (window as unknown as { vera: VeraBridge }).vera;
        let text = "";
        const off = api.subscribe("session", id, 0, (event) => {
          if (event.type === "message.delta") text += event.text;
        });
        Object.assign(globalThis, {
          mask04ReadLive: () => {
            off();
            return text;
          },
        });
      }, session.id);
      await invoke(page, "session.send", { sessionId: session.id, text: "Read and save" });
      await expect
        .poll(async () =>
          (await invoke(page, "session.get", { sessionId: session.id })).snapshot.items.some(
            (item) => item.kind === "assistant" && item.text.startsWith("Answer"),
          ),
        )
        .toBe(true);
      await expect
        .poll(async () => (await invoke(page, "session.get", { sessionId: session.id })).snapshot.status)
        .toBe("idle");
      const live = await page.evaluate(() =>
        (globalThis as unknown as { mask04ReadLive(): string }).mask04ReadLive(),
      );
      expect(live).toContain(masked ? "[REDACTED]" : secret);
      if (masked) expect(live).not.toContain(secret);
      return session.id;
    };
    await setApp(false, false);
    const raw = await run(false);
    const state = await invoke(page, "session.get", { sessionId: raw });
    expect(JSON.stringify(state)).toContain(secret);
    const tool = state.snapshot.items.find((item) => item.kind === "tool" && item.name === "artifact_save");
    if (!tool) throw Error("read result missing");
    expect(
      (await invoke(page, "session.item.detail", { sessionId: raw, itemId: tool.id, field: "args" })).text,
    ).toContain(secret);
    const artifact = (await invoke(page, "artifacts.list", { sessionId: raw }))[0];
    if (!artifact) throw Error("artifact missing");
    expect((await invoke(page, "artifacts.open", { artifactId: artifact.artifactId })).content).toBe(secret);
    for (const agent of [true, false])
      for (const exports of [true, false]) {
        await setApp(agent, exports);
        expect(JSON.stringify(await invoke(page, "session.get", { sessionId: raw })).includes(secret)).toBe(
          !agent,
        );
        expect(
          (await invoke(page, "session.search", { workbenchId: bench.config.id, query: secret })).length > 0,
        ).toBe(!agent);
        for (const format of ["json", "md"] as const) {
          const target = join(scratch, `session-${agent}-${exports}.${format}`);
          await app.evaluate((_electron, target) => {
            process.env.VERA_TEST_DIALOG_PATH = target;
          }, target);
          expect(await invoke(page, "session.export", { sessionId: raw, format })).toEqual({
            exported: true,
          });
          const content = await readFile(target, "utf8");
          expect(content.includes(secret)).toBe(!exports);
          receipts.push({ agent, exports, format, containsSecret: content.includes(secret) });
        }
        const target = join(scratch, `artifact-${agent}-${exports}.txt`);
        await app.evaluate((_electron, target) => {
          process.env.VERA_TEST_DIALOG_PATH = target;
        }, target);
        await invoke(page, "artifacts.export", { artifactId: artifact.artifactId });
        expect(await readFile(target, "utf8")).toBe(exports ? "[REDACTED]" : secret);
      }
    await setApp(true, true);
    const masked = await run(true);
    expect(JSON.stringify(await invoke(page, "session.get", { sessionId: masked }))).not.toContain(secret);
    const saved = (await invoke(page, "artifacts.list", { sessionId: masked }))[0];
    expect(await readFile(join(folder, ".vera/artifacts", masked, "report.txt"), "utf8")).toBe("[REDACTED]");
    await setApp(false, false);
    expect((await invoke(page, "artifacts.open", { artifactId: saved?.artifactId ?? "" })).content).toBe(
      "[REDACTED]",
    );
    await invoke(page, "workbench.config.update", {
      workbenchId: bench.config.id,
      patch: { privacy: { mask: { agent: "on", exports: "on" } } },
    });
    expect(JSON.stringify(await invoke(page, "session.get", { sessionId: raw }))).not.toContain(secret);
    const overrideTarget = join(scratch, "override.txt");
    await app.evaluate((_electron, target) => {
      process.env.VERA_TEST_DIALOG_PATH = target;
    }, overrideTarget);
    await invoke(page, "artifacts.export", { artifactId: artifact.artifactId });
    expect(await readFile(overrideTarget, "utf8")).toBe("[REDACTED]");
    await invoke(page, "workbench.create", { folder: other, name: "Other" });
    expect((await invoke(page, "workbench.config.get", {})).config.privacy?.mask?.agent).toBeUndefined();
    expect(await outboundAttempts(app)).toEqual([]);
    await writeFile(
      join(evidence, "receipt.json"),
      JSON.stringify(
        {
          platform: process.platform,
          base: "be4e3120d747c5b2e2c78ea617417c7166605e4d",
          receipts,
          irreversibleSavedRedaction: true,
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
