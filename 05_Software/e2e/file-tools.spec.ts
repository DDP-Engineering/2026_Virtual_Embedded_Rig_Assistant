import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

interface Probe {
  start(root: string, args: unknown, deadlineMs?: number): Promise<void>;
  partials(): number;
  result(): Promise<{ matches: unknown[]; truncated: boolean; reason?: string }>;
  abort(): void;
}
test("pathological desktop grep leaves app.info responsive, times out/aborts and replaces capacity", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-wp11-native-"));
  await writeFile(join(root, "00-good.txt"), "ok");
  await writeFile(join(root, "99-bad.txt"), `${"a".repeat(30000)}!`);
  const desktop = join(dirname(fileURLToPath(import.meta.url)), "../apps/desktop");
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((x): x is [string, string] => typeof x[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: join(
      desktop,
      "../../node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    chromiumSandbox: true,
    args: [desktop, `--user-data-dir=${join(root, "data")}`],
    env,
  });
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    expect(await app.evaluate(() => Object.hasOwn(globalThis, "veraTestFileTools"))).toBe(true);
    await app.evaluate(async (_, root) => {
      await (Reflect.get(globalThis, "veraTestFileTools") as Probe).start(
        root,
        { pattern: "ok|(a+)+$", glob: "*.txt" },
        1500,
      );
    }, root);
    await expect
      .poll(() => app.evaluate(() => (Reflect.get(globalThis, "veraTestFileTools") as Probe).partials()))
      .toBe(1);
    const started = Date.now();
    const info = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("app.info", {}),
    );
    expect(info.platform).toBe(process.platform);
    expect(Date.now() - started).toBeLessThan(1000);
    const timed = await app.evaluate(() => (Reflect.get(globalThis, "veraTestFileTools") as Probe).result());
    expect(timed).toMatchObject({ reason: "timeout", truncated: true, matches: [{ path: "00-good.txt" }] });
    await app.evaluate(async (_, root) => {
      await (Reflect.get(globalThis, "veraTestFileTools") as Probe).start(root, {
        pattern: "ok|(a+)+$",
        glob: "*.txt",
      });
    }, root);
    await expect
      .poll(() => app.evaluate(() => (Reflect.get(globalThis, "veraTestFileTools") as Probe).partials()))
      .toBe(1);
    await page.evaluate(() => (window as unknown as { vera: VeraBridge }).vera.invoke("app.info", {}));
    await app.evaluate(() => (Reflect.get(globalThis, "veraTestFileTools") as Probe).abort());
    expect(
      await app.evaluate(() => (Reflect.get(globalThis, "veraTestFileTools") as Probe).result()),
    ).toMatchObject({ reason: "aborted", truncated: true });
    await app.evaluate(async (_, root) => {
      await (Reflect.get(globalThis, "veraTestFileTools") as Probe).start(root, {
        pattern: "ok",
        glob: "00*",
      });
    }, root);
    expect(
      await app.evaluate(() => (Reflect.get(globalThis, "veraTestFileTools") as Probe).result()),
    ).toMatchObject({ truncated: false, matches: [{ path: "00-good.txt" }] });
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
