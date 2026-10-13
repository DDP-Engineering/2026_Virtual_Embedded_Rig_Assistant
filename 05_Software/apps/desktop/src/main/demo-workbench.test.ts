// REQ-FUNC-66b6fda6: future scenarios; execution deferred by user policy.
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireWorkbenchGuard } from "@vera/core";
import { demoWorkbench } from "@vera/shared";
import { expect, it } from "vitest";
import { prepareDemoWorkbench } from "./demo-workbench.js";

const bundled = fileURLToPath(new URL("../../../../fixtures/workbenches/demo-board", import.meta.url));

it("installs the complete corpus privately and reopens without replacing edits or runtime data", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-demo-copy-"));
  try {
    const folder = await prepareDemoWorkbench(root, bundled);
    for (const path of demoWorkbench.files)
      expect(await readFile(join(folder, path))).toEqual(await readFile(join(bundled, path)));
    await writeFile(join(folder, "WORKBENCH.md"), "my edited context");
    await mkdir(join(folder, ".vera"));
    await writeFile(join(folder, ".vera/keep.txt"), "my session data");
    expect(await prepareDemoWorkbench(root, "/unavailable-source")).toBe(folder);
    expect(await readFile(join(folder, "WORKBENCH.md"), "utf8")).toBe("my edited context");
    expect(await readFile(join(folder, ".vera/keep.txt"), "utf8")).toBe("my session data");
    expect(await readFile(join(bundled, "WORKBENCH.md"), "utf8")).toContain("# VERA-DEMO-01");
    expect(await readdir(join(root, "demo-workbenches"))).toEqual([demoWorkbench.name]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("cleans its partial staging after a missing asset and can retry with the complete source", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-demo-failure-"));
  try {
    const source = join(root, "incomplete");
    await mkdir(source);
    await writeFile(join(source, "workbench.yaml"), "format: 1");
    await expect(prepareDemoWorkbench(root, source)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(join(root, "demo-workbenches"))).toEqual([]);
    expect(await prepareDemoWorkbench(root, bundled)).toBe(
      join(root, "demo-workbenches", demoWorkbench.name),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses an incomplete existing target and redirects without altering foreign files", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-demo-conflict-"));
  try {
    const parent = join(root, "demo-workbenches");
    const target = join(parent, demoWorkbench.name);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "keep.txt"), "keep");
    await expect(prepareDemoWorkbench(root, bundled)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await readFile(join(target, "keep.txt"), "utf8")).toBe("keep");
    await rm(target, { recursive: true });
    const foreign = join(root, "foreign");
    await mkdir(foreign);
    await writeFile(join(foreign, "keep.txt"), "foreign");
    await symlink(foreign, target, process.platform === "win32" ? "junction" : "dir");
    await expect(prepareDemoWorkbench(root, bundled)).rejects.toMatchObject({ code: "DENIED" });
    expect(await readdir(foreign)).toEqual(["keep.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("uses the existing OS guard for concurrent installation and releases it after failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-demo-busy-"));
  let release: (() => Promise<void>) | undefined;
  try {
    const parent = join(root, "demo-workbenches");
    await mkdir(parent);
    release = await acquireWorkbenchGuard(join(parent, ".demo-install"));
    expect(release).toBeDefined();
    await expect(prepareDemoWorkbench(root, bundled)).rejects.toMatchObject({ code: "BUSY" });
    await release?.();
    release = undefined;
    await expect(prepareDemoWorkbench(root, bundled)).resolves.toContain(demoWorkbench.name);
  } finally {
    await release?.();
    await rm(root, { recursive: true, force: true });
  }
});
