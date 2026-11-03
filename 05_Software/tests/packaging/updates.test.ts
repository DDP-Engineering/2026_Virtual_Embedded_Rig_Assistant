import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

// @ts-expect-error Native ESM build helpers.
import { pluginCatalogFeed, updateFeed, updatePublish } from "../../scripts/update-config.mjs";
// @ts-expect-error Native ESM feed server.
import { startUpdateFeed } from "../../scripts/update-feed.mjs";

it("fixes HTTPS feed at build time and permits HTTP loopback only in test builds", () => {
  expect(updateFeed()).toBe("");
  expect(updatePublish("https://updates.test/vera")).toEqual([
    { provider: "generic", url: "https://updates.test/vera/", channel: "latest" },
  ]);
  for (const url of [
    "http://updates.test/",
    "http://127.0.0.1/",
    "https://user:pass@updates.test/",
    "file:///tmp",
    "https://updates.test/?token=a",
  ]) {
    expect(() => updateFeed(url)).toThrow();
  }
  expect(updateFeed("http://127.0.0.1:1234", true)).toBe("http://127.0.0.1:1234/");
  expect(() => updateFeed("http://192.168.1.2", true)).toThrow();
});
// REQ-SEC-a3c31442
it("fixes the default plugin catalog at build time under the update feed rule", () => {
  expect(pluginCatalogFeed()).toBe("");
  expect(pluginCatalogFeed("https://catalog.test/vera")).toBe("https://catalog.test/vera/");
  expect(pluginCatalogFeed("http://127.0.0.1:8123/c", true)).toBe("http://127.0.0.1:8123/c/");
  for (const url of ["http://catalog.test/", "http://127.0.0.1/", "https://catalog.test/?t=1"])
    expect(() => pluginCatalogFeed(url)).toThrow("Invalid plugin catalog build setting");
});
it("serves only explicit local feed files and records metadata/artifact requests with range support", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-update-feed-"));
  await mkdir(join(root, "feed"));
  await writeFile(join(root, "feed/latest.yml"), "version: 1.0.1");
  await writeFile(join(root, "feed/update.exe"), "abcdef");
  const feed = await startUpdateFeed(join(root, "feed"));
  try {
    expect(await (await fetch(`${feed.url}latest.yml`)).text()).toBe("version: 1.0.1");
    const part = await fetch(`${feed.url}update.exe`, { headers: { Range: "bytes=1-3" } });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("bcd");
    expect((await fetch(`${feed.url}%2e%2e%2foutside`)).status).toBe(404);
    expect(feed.requests.map((r: { path: string }) => r.path)).toEqual(["latest.yml", "update.exe"]);
  } finally {
    await feed.close();
    await rm(root, { recursive: true, force: true });
  }
});
