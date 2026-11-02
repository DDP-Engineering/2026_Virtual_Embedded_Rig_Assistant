import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginPlatform } from "@vera/core";
import { afterEach, expect, it } from "vitest";
import { cliUv } from "./provisioning.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const name = process.platform === "win32" ? "uv.exe" : "uv";
const platform = pluginPlatform(process.platform, process.arch) ?? "unsupported";

// REQ-FUNC-565e908d
it("takes uv only from the workspace beside the CLI build, never from another ancestor", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-cli-uv-"));
  roots.push(root);
  const dist = join(root, "05_Software", "src", "apps", "cli", "dist");
  await mkdir(dist, { recursive: true });
  expect(cliUv(dist)).toBeUndefined();
  // A uv planted higher up (for example C:\src\uv\…) is never used.
  await mkdir(join(root, "src", "uv", platform), { recursive: true });
  await writeFile(join(root, "src", "uv", platform, name), "");
  await mkdir(join(root, "resources", "uv"), { recursive: true });
  await writeFile(join(root, "resources", "uv", name), "");
  expect(cliUv(dist)).toBeUndefined();
  const pinned = join(root, "05_Software", "src", "uv", platform, name);
  await mkdir(join(pinned, ".."), { recursive: true });
  await writeFile(pinned, "");
  expect(cliUv(dist)).toBe(pinned);
});
