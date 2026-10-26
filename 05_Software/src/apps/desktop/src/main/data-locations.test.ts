import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, it, vi } from "vitest";

let configureDataLocations: typeof import("./data-locations.js").configureDataLocations;
beforeAll(async () => {
  expect(existsSync(new URL("./data-locations.ts", import.meta.url)), "portable path logic exists").toBe(
    true,
  );
  ({ configureDataLocations } = await import("./data-locations.js"));
});
function directoryHost(initial: string) {
  let userData = initial;
  return {
    getPath: () => userData,
    setPath: vi.fn((_key: "userData", path: string) => {
      if (!existsSync(path) || !statSync(path).isDirectory())
        throw new Error("Electron userData override requires an existing directory");
      userData = path;
    }),
  };
}

it("first portable launch creates the absent data directory before Electron setPath", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vera-first-portable-"));
  try {
    await writeFile(join(dir, "vera.portable"), "");
    const data = join(dir, "data");
    const host = directoryHost(join(dir, "installed"));
    expect(existsSync(data)).toBe(false);
    const result = configureDataLocations(host, join(dir, "vera.exe"));
    expect(statSync(data).isDirectory()).toBe(true);
    expect(host.setPath).toHaveBeenCalledExactlyOnceWith("userData", data);
    expect(result).toMatchObject({ portable: true, paths: { userData: data } });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("existing portable data and its contents survive selection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vera-existing-portable-"));
  try {
    await writeFile(join(dir, "vera.portable"), "");
    const data = join(dir, "data");
    await mkdir(data);
    await writeFile(join(data, "settings.json"), "preserve");
    const host = directoryHost(join(dir, "installed"));
    expect(configureDataLocations(host, join(dir, "vera.exe")).paths.userData).toBe(data);
    expect(readFileSync(join(data, "settings.json"), "utf8")).toBe("preserve");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("real portable directory creation errors propagate without selecting installed or override data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vera-blocked-portable-"));
  try {
    await writeFile(join(dir, "vera.portable"), "");
    await writeFile(join(dir, "data"), "file blocks directory");
    const installed = join(dir, "installed");
    const override = join(dir, "override");
    const host = directoryHost(installed);
    expect(() => configureDataLocations(host, join(dir, "vera.exe"), override)).toThrow(
      expect.objectContaining({ code: expect.stringMatching(/^(EEXIST|ENOTDIR)$/) }),
    );
    expect(host.setPath).not.toHaveBeenCalled();
    expect(host.getPath()).toBe(installed);
    expect(existsSync(override)).toBe(false);
    expect(readFileSync(join(dir, "data"), "utf8")).toBe("file blocks directory");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("regular marker switches userData to executable-adjacent data before readiness", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vera-portable-"));
  try {
    const installed = join(dir, "installed");
    const override = join(dir, "isolated", "nested");
    const host = directoryHost(installed);
    const executable = join(dir, "vera.exe");
    expect(configureDataLocations(host, executable).paths.userData).toBe(installed);
    expect(host.setPath).not.toHaveBeenCalled();
    expect(existsSync(installed)).toBe(false);
    expect(configureDataLocations(host, executable, override).paths.userData).toBe(override);
    expect(statSync(override).isDirectory()).toBe(true);
    await mkdir(join(dir, "vera.portable"));
    expect(configureDataLocations(host, executable).portable).toBe(false);
    await rm(join(dir, "vera.portable"), { recursive: true });
    await writeFile(join(dir, "vera.portable"), "");
    const selected = configureDataLocations(host, executable, override);
    expect(selected.portable).toBe(true);
    const userData = join(dir, "data");
    expect(host.getPath()).toBe(userData);
    expect(selected.paths).toEqual({
      userData,
      settings: join(userData, "settings.json"),
      logs: join(userData, "logs"),
    });
    const bootstrap = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(bootstrap.indexOf("configureDataLocations(")).toBeGreaterThan(-1);
    expect(bootstrap.indexOf("configureDataLocations(")).toBeLessThan(bootstrap.indexOf(".whenReady()"));
    expect(bootstrap.indexOf("configureDataLocations(")).toBeLessThan(
      bootstrap.indexOf("requestSingleInstanceLock()"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
