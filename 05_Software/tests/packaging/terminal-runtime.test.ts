import { cp, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it("loads the staged Windows JS closure and retains its shared and worker modules", async () => {
  const { ptyRuntimeFile, checkPtyJavaScript } = await import(
    pathToFileURL(resolve("../02_Tools/release/package-checks.mjs")).href
  );
  const base = resolve("evaluation-outputs/term05");
  await mkdir(base, { recursive: true });
  const stage = await mkdtemp(join(base, "owned-pty-closure-"));
  const source = resolve("node_modules/node-pty");
  try {
    await cp(source, stage, {
      recursive: true,
      filter: (path) =>
        ptyRuntimeFile(`node_modules/node-pty/${relative(source, path).replaceAll("\\", "/")}`, "win32"),
    });
    const stagedRequire = createRequire(join(stage, "package.json"));
    expect(() => stagedRequire("./lib/windowsTerminal.js")).not.toThrow();
    expect(await readFile(join(stage, "lib/worker/conoutSocketWorker.js"), "utf8")).toContain(
      "../shared/conout",
    );
    async function inspect(folder: string) {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) await inspect(path);
        else if (entry.name.endsWith(".js")) {
          const code = await readFile(path, "utf8");
          for (const match of code.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
            expect(() => stagedRequire.resolve(resolve(dirname(path), match[1] as string))).not.toThrow();
          }
        }
      }
    }
    await inspect(join(stage, "lib"));
    expect(
      await checkPtyJavaScript((path: string) =>
        readFile(join(stage, path.slice("node_modules/node-pty/".length))),
      ),
    ).toBeGreaterThan(10);
    await rm(join(stage, "lib/shared/conout.js"));
    await expect(
      checkPtyJavaScript((path: string) =>
        readFile(join(stage, path.slice("node_modules/node-pty/".length))),
      ),
    ).rejects.toThrow();
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
});

it("checks actual PE/ELF PTY architecture and records each native helper hash", async () => {
  const checks = await import(pathToFileURL(resolve("../02_Tools/release/package-checks.mjs")).href);
  expect(checks.checkPtyNative).toBeTypeOf("function");
  const elf = Buffer.alloc(64);
  elf.write("\u007fELF");
  elf[4] = 2;
  elf[5] = 1;
  elf.writeUInt16LE(62, 18);
  const files = await checks.checkPtyNative(async () => elf, "linux");
  expect(files).toHaveLength(1);
  expect(files[0]).toMatchObject({ bytes: 64, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  const wrong = Buffer.from(elf);
  wrong.writeUInt16LE(183, 18);
  await expect(checks.checkPtyNative(async () => wrong, "linux")).rejects.toThrow(/architecture/);
  await expect(checks.checkPtyNative(async () => elf, "win32")).rejects.toThrow(/architecture/);
});

it("excludes foreign node-pty native builds and requires its helper closure", async () => {
  const { foreignNative, validateNativeFiles } = await import(
    pathToFileURL(resolve("../02_Tools/release/package-checks.mjs")).href
  );
  expect(foreignNative("node_modules/node-pty/prebuilds/win32-arm64/conpty.node", "win32")).toBe(true);
  expect(foreignNative("node_modules/node-pty/prebuilds/linux-x64/pty.node", "win32")).toBe(true);
  expect(foreignNative("node_modules/node-pty/prebuilds/win32-x64/conpty.node", "win32")).toBe(false);
  const windows = [
    "better-sqlite3/prebuilds/win32-x64.node",
    ...["onnxruntime_binding.node", "onnxruntime.dll", "DirectML.dll", "dxcompiler.dll", "dxil.dll"].map(
      (name) => `onnxruntime-node/bin/napi-v6/win32/x64/${name}`,
    ),
  ].map((path) => `node_modules/${path}`);
  expect(() => validateNativeFiles(windows, "win32")).toThrow(/node-pty/);
});
