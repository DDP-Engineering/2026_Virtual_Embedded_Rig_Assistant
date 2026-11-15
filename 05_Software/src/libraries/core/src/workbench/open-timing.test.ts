import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { SettingsService } from "../settings/service.js";
import { WorkbenchService } from "./service.js";

// Opt-in timing (PERF-09, #257): VERA_OPEN_TIMING_MB=200 npx vitest run open-timing
// Reports total open time and the longest event-loop gap while a workbench of that size opens.
const megabytes = Number(process.env.VERA_OPEN_TIMING_MB ?? 0);
const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
async function service(root: string) {
  const files = {
    read: async (path: string) => readFile(path, "utf8").catch(() => undefined),
    writeAtomic: async (path: string, text: string) => writeFile(path, text),
    backup: async () => true,
  };
  const paths = { userData: root, settings: join(root, "settings.json"), logs: join(root, "logs") };
  const settings = new SettingsService({ files, paths, uuid: randomUUID, changed: () => {} });
  await settings.load();
  return new WorkbenchService({
    userData: root,
    files,
    settings,
    appVersion: "0.0.0",
    now: () => new Date(),
    pid: process.pid,
    isProcessAlive: (pid: number) => pid === process.pid,
    token: randomUUID,
    changed: () => {},
  });
}
async function timed(open: () => Promise<unknown>) {
  let last = performance.now();
  let gap = 0;
  const beat = setInterval(() => {
    const now = performance.now();
    gap = Math.max(gap, now - last);
    last = now;
  }, 5);
  const start = performance.now();
  await open();
  const end = performance.now();
  clearInterval(beat);
  return { totalMs: Math.round(end - start), longestGapMs: Math.round(Math.max(gap, end - last)) };
}
it.skipIf(!megabytes)(
  `opens a ${megabytes} MB workbench without long main-thread blocking`,
  async () => {
    const root = await mkdtemp(join(tmpdir(), "vera-open-timing-"));
    roots.push(root);
    const folder = join(root, "bench");
    await mkdir(folder);
    const first = await service(root);
    await first.create(folder, "Timing");
    first.getDatabase().exec("CREATE TABLE pad(b BLOB)");
    const insert = first.getDatabase().prepare("INSERT INTO pad VALUES (randomblob(1048576))");
    first.getDatabase().transaction(() => {
      for (let i = 0; i < megabytes; i++) insert.run();
    })();
    await first.close();
    const owned = await service(root);
    const ownedTiming = await timed(() => owned.open(folder));
    // A live foreign owner makes the next open read-only, through the private copy.
    const foreign = await service(root);
    const readOnlyTiming = await timed(() => foreign.open(folder));
    expect(foreign.getSnapshot().readOnly).toBe(true);
    expect(foreign.getDatabase().prepare("SELECT count(*) FROM pad").pluck().get()).toBe(megabytes);
    await foreign.close();
    await owned.close();
    console.log(JSON.stringify({ megabytes, owned: ownedTiming, readOnly: readOnlyTiming }));
  },
  600_000,
);
