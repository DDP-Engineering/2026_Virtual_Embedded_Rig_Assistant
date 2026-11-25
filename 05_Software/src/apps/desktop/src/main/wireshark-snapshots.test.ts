import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { expect, it } from "vitest";
import { WiresharkFrameSnapshots } from "./wireshark-snapshots.js";

it("reclaims abandoned capture profiles only after VERA and their viewer have both exited", async () => {
  const data = await mkdtemp(join(tmpdir(), "vera-wireshark-snapshots-test-"));
  try {
    const snapshots = new WiresharkFrameSnapshots(data);
    const activeViewer = await snapshots.create();
    const previousViewer = await snapshots.create();
    const incomplete = await snapshots.create();
    const viewerPid = process.pid + 1;
    activeViewer.recordViewer(viewerPid);
    previousViewer.recordViewer(viewerPid + 1);
    const root = join(data, "wireshark-frames");
    const unrelated = join(root, "frame-Other1");
    await mkdir(unrelated);
    await writeFile(join(unrelated, "other.txt"), "unrelated data");
    await writeFile(join(previousViewer.folder, "verified.pcapng"), "test capture");

    // An active VERA owner may be preparing its frame, even when a viewer has not started yet.
    await snapshots.reclaim((pid) => pid === process.pid);
    expect(await readdir(root)).toHaveLength(4);
    // VERA has exited while one viewer is still reading its snapshot.
    await snapshots.reclaim((pid) => pid === viewerPid);
    expect(await readdir(root)).toHaveLength(2);
    expect(isAbsolute(activeViewer.folder)).toBe(true);
    expect(await readdir(activeViewer.folder)).toContain("viewer.json");
    expect(await readdir(unrelated)).toContain("other.txt");
    await expect(readdir(previousViewer.folder)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(incomplete.folder)).rejects.toMatchObject({ code: "ENOENT" });
    await snapshots.reclaim(() => false);
    expect(await readdir(root)).toEqual(["frame-Other1"]);
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});
