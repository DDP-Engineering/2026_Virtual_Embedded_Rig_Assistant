import { writeFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const marker = (pid: number) => JSON.stringify({ format: 1, pid });
const markerSchema = z.strictObject({
  format: z.literal(1),
  pid: z.number().int().positive().max(0x7fffffff),
});
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

async function readPid(path: string) {
  const info = await lstat(path).catch((error: unknown) => {
    if (!missing(error)) throw error;
  });
  if (!info) return undefined;
  if (!info.isFile() || info.nlink !== 1 || info.size > 64) throw Error("Invalid Wireshark snapshot marker.");
  return markerSchema.parse(JSON.parse(await readFile(path, "utf8"))).pid;
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** A private verified capture and its profile belong to VERA and the detached viewer. */
export class WiresharkFrameSnapshots {
  constructor(private readonly userData: string) {}

  private async root(create: boolean) {
    const root = join(await realpath(this.userData), "wireshark-frames");
    if (create) await mkdir(root, { mode: 0o700, recursive: true });
    if (!(await lstat(root)).isDirectory() || (await realpath(root)) !== root)
      throw Error("Invalid Wireshark snapshot directory.");
    return root;
  }

  async create() {
    const folder = await mkdtemp(join(await this.root(true), "frame-"));
    const remove = () => rm(folder, { recursive: true, force: true });
    try {
      await writeFile(join(folder, "owner.json"), marker(process.pid), { mode: 0o600, flag: "wx" });
    } catch (error) {
      await remove().catch(() => {});
      throw error;
    }
    return {
      folder,
      recordViewer(pid: number) {
        writeFileSync(join(folder, "viewer.json"), marker(pid), { mode: 0o600, flag: "wx" });
      },
      remove,
    };
  }

  /** Reclaims only VERA-owned directories with no live application or native viewer process. */
  async reclaim(alive = processAlive) {
    const root = await this.root(false).catch((error: unknown) => {
      if (!missing(error)) throw error;
    });
    if (!root) return;
    for (const item of await readdir(root, { withFileTypes: true })) {
      if (!item.isDirectory() || !/^frame-[a-zA-Z0-9]{6}$/.test(item.name)) continue;
      const folder = join(root, item.name);
      let viewer: number | undefined;
      try {
        if ((await realpath(folder)) !== folder) continue;
        const owner = await readPid(join(folder, "owner.json"));
        if (owner === undefined || alive(owner)) continue;
        viewer = await readPid(join(folder, "viewer.json"));
      } catch {
        continue;
      }
      if (viewer === undefined || !alive(viewer)) await rm(folder, { recursive: true, force: true });
    }
  }
}
