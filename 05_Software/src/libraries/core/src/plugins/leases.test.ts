import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type LeaseClaim, leaseFileName, leaseRoot, ResourceLeases } from "./leases.js";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-leases-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const claim = (fields: Partial<LeaseClaim> = {}): LeaseClaim => ({
  kind: "visa",
  alias: "psu",
  resource: "USB0::0x1AB1::0x0E11::DP8C1::INSTR",
  keys: ["usb:1ab1:0e11:dp8c1"],
  actuates: true,
  ...fields,
});
const owner = (runId: string) => ({ sessionId: "s1", runId });
const leases = (pid: number, alive: (pid: number) => boolean = () => true) =>
  new ResourceLeases({ root, app: "test", pid, alive, now: () => new Date("2026-11-13T10:00:00Z") });
const busy = (params: Record<string, unknown>) =>
  expect.objectContaining({ code: "BUSY", params: expect.objectContaining(params) });

describe("ResourceLeases", () => {
  it("refuses a key another instance holds and frees it on release", async () => {
    const desktop = leases(101);
    const cli = leases(202);
    const held = await desktop.acquire([claim()], owner("RUN1"));
    await expect(cli.acquire([claim({ alias: "psu-lan" })], owner("RUN2"))).rejects.toEqual(
      busy({ resource: "psu-lan", holder: "process 101" }),
    );
    const files = await readdir(root);
    expect(files).toContain(leaseFileName("usb:1ab1:0e11:dp8c1"));
    const lease = JSON.parse(await readFile(join(root, leaseFileName("usb:1ab1:0e11:dp8c1")), "utf8"));
    expect(lease).toMatchObject({
      format: 1,
      key: "usb:1ab1:0e11:dp8c1",
      pid: 101,
      runId: "RUN1",
      actuates: true,
    });
    await held.release();
    expect((await readdir(root)).filter((name) => name.endsWith(".lease"))).toEqual([]);
    await (await cli.acquire([claim()], owner("RUN2"))).release();
  });

  it("takes all keys of a claim or none", async () => {
    const one = leases(101);
    const two = leases(202);
    const held = await one.acquire([claim({ keys: ["serial-number:dp8c1"] })], owner("RUN1"));
    await expect(
      two.acquire([claim({ keys: ["usb:1ab1:0e11:dp8c1", "serial-number:dp8c1"] })], owner("RUN2")),
    ).rejects.toEqual(busy({ resource: "psu" }));
    expect((await readdir(root)).filter((name) => name.endsWith(".lease"))).toEqual([
      leaseFileName("serial-number:dp8c1"),
    ]);
    await held.release();
  });

  it("removes a lost process's lease and records unknown when it could actuate", async () => {
    const lost = leases(999, () => true);
    await lost.acquire([claim()], owner("LOST"));
    await lost.acquire(
      [claim({ alias: "dmm", keys: ["usb:2a8d:1301:my1"], actuates: false })],
      owner("LOST2"),
    );
    const next = leases(101, (pid) => pid !== 999);
    const held = await next.acquire([claim()], owner("RUN1"));
    expect(held.states).toEqual({
      psu: expect.objectContaining({ state: "unknown", runId: "LOST", reason: "holder-lost" }),
    });
    await held.release();
    const read = await next.acquire(
      [claim({ alias: "dmm", keys: ["usb:2a8d:1301:my1"], actuates: false })],
      owner("R2"),
    );
    expect(read.states).toEqual({});
    await read.release();
    // The marker stays until a confirmed state clears it.
    const again = await next.acquire([claim()], owner("RUN3"));
    expect(Object.keys(again.states)).toEqual(["psu"]);
    await again.clear();
    await again.release();
    const clean = await next.acquire([claim()], owner("RUN4"));
    expect(clean.states).toEqual({});
    await clean.release();
  });

  it("treats an unreadable lease as held and never deletes it", async () => {
    await writeFile(join(root, leaseFileName("usb:1ab1:0e11:dp8c1")), "{not json");
    await expect(leases(101).acquire([claim()], owner("RUN1"))).rejects.toEqual(
      busy({ resource: "psu", holder: "an unreadable lease" }),
    );
    expect(await readFile(join(root, leaseFileName("usb:1ab1:0e11:dp8c1")), "utf8")).toBe("{not json");
  });

  it("records and clears unknown states for every claimed key", async () => {
    const one = leases(101);
    const held = await one.acquire([claim({ keys: ["a", "b"] })], owner("RUN1"));
    await held.markUnknown("cleanup-failed");
    await held.release();
    const states = await readdir(root);
    expect(states.filter((name) => name.endsWith(".state")).sort()).toEqual(
      [leaseFileName("a"), leaseFileName("b")].map((name) => name.replace(/\.lease$/, ".state")).sort(),
    );
    const next = await one.acquire([claim({ keys: ["b"] })], owner("RUN2"));
    expect(next.states.psu).toMatchObject({ state: "unknown", runId: "RUN1", reason: "cleanup-failed" });
    await next.release();
  });

  it("creates and removes a run control folder inside the lease folder", async () => {
    const one = leases(101);
    const folder = await one.controlFolder("01JABCDEFGHJKMNPQRSTVWXYZ0");
    expect(folder).toBe(join(root, "runs", "01JABCDEFGHJKMNPQRSTVWXYZ0"));
    expect(await readdir(folder)).toEqual([]);
    await one.removeControl("01JABCDEFGHJKMNPQRSTVWXYZ0");
    expect(await readdir(join(root, "runs"))).toEqual([]);
  });
});

describe("leaseRoot", () => {
  it("uses LOCALAPPDATA on Windows and XDG_RUNTIME_DIR or a private temporary folder on Linux", () => {
    expect(
      leaseRoot({
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
        tmpdir: "C:\\T",
      }),
    ).toBe(join("C:\\Users\\me\\AppData\\Local", "VERA", "leases"));
    expect(leaseRoot({ platform: "win32", env: {}, tmpdir: "C:\\T" })).toBe(join("C:\\T", "vera-leases"));
    expect(
      leaseRoot({ platform: "linux", env: { XDG_RUNTIME_DIR: "/run/user/1000" }, tmpdir: "/tmp", uid: 1000 }),
    ).toBe(join("/run/user/1000", "vera-leases"));
    expect(
      leaseRoot({ platform: "linux", env: { XDG_RUNTIME_DIR: "relative" }, tmpdir: "/tmp", uid: 1000 }),
    ).toBe(join("/tmp", "vera-leases-1000"));
  });

  it.skipIf(process.platform === "win32")("refuses a Linux lease folder others can enter", async () => {
    const folder = join(root, "shared");
    await mkdir(folder);
    await chmod(folder, 0o755);
    const open = new ResourceLeases({ root: folder, app: "test", pid: 101, alive: () => true });
    await expect(open.acquire([claim()], owner("RUN1"))).rejects.toEqual(
      expect.objectContaining({ code: "DENIED", params: { reason: "leases" } }),
    );
  });
});
