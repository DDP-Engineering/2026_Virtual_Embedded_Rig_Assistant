import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";

const common = await import(
  /* @vite-ignore */ pathToFileURL(`${process.cwd()}/../02_Tools/delivery/delivery-common.mjs`).href
);
let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "vera-delivery-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

test("delivery version and folder carry the commit while the desktop version is 0.0.0", () => {
  expect(common.deliveryVersion("0.0.0", "bf7a6eb")).toBe("0.0.0-bf7a6eb");
  expect(common.deliveryVersion("1.2.0", "bf7a6eb")).toBe("1.2.0");
  expect(common.deliveryFolderName("1.2.0")).toBe("vera-1.2.0");
});

test("a platform is built only on its own host", () => {
  expect(common.hostPlatform("win32", "x64")).toBe("windows-x64");
  expect(common.hostPlatform("linux", "x64")).toBe("linux-x64");
  expect(common.hostPlatform("darwin", "arm64")).toBeUndefined();
  expect(() => common.requireHost("windows-x64", "windows-x64")).not.toThrow();
  expect(() => common.requireHost("linux-x64", "windows-x64")).toThrow(/linux-x64 host/);
  expect(() => common.requireHost("macos-arm64", "windows-x64")).toThrow(/--platform/);
});

test("SHA256SUMS is written sorted and verified against the files", async () => {
  await writeFile(join(folder, "b.zip"), "bravo");
  await writeFile(join(folder, "a.exe"), "alpha");
  const entries = [await common.describeFile(folder, "b.zip"), await common.describeFile(folder, "a.exe")];
  expect(entries[1]).toEqual({
    path: "a.exe",
    bytes: 5,
    sha256: "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8",
  });
  await common.writeSums(folder, entries);
  expect(await readFile(join(folder, "SHA256SUMS"), "utf8")).toBe(
    `${entries[1].sha256}  a.exe\n${entries[0].sha256}  b.zip\n`,
  );
  expect(await common.readSums(folder)).toEqual([
    { path: "a.exe", sha256: entries[1].sha256 },
    { path: "b.zip", sha256: entries[0].sha256 },
  ]);
  expect(await common.checkSums(folder)).toEqual([]);

  await writeFile(join(folder, "a.exe"), "alphA");
  await writeFile(join(folder, "extra.txt"), "x");
  await rm(join(folder, "b.zip"));
  expect(await common.checkSums(folder)).toEqual([
    "a.exe: SHA-256 mismatch",
    "b.zip: missing",
    "extra.txt: not in SHA256SUMS",
  ]);
  expect(common.parseSums(`${entries[0].sha256} *b.zip\n`)).toEqual([
    { path: "b.zip", sha256: entries[0].sha256 },
  ]);
  expect(() => common.parseSums("not a sum\n")).toThrow(/malformed/);
});

test("a part is never overwritten without --replace, and replacing leaves no old copy", async () => {
  const target = join(folder, "plugins");
  const first = await common.startStaging(folder, "plugins");
  await writeFile(join(first, "index.json"), "1");
  await common.commitPart(first, target, false);
  expect(await readFile(join(target, "index.json"), "utf8")).toBe("1");

  const second = await common.startStaging(folder, "plugins");
  await writeFile(join(second, "index.json"), "2");
  await expect(common.commitPart(second, target, false)).rejects.toThrow(/--replace/);
  expect(() => common.assertCanWrite(target, false)).toThrow(/--replace/);
  expect(await readFile(join(target, "index.json"), "utf8")).toBe("1");

  await common.commitPart(second, target, true);
  expect(await readFile(join(target, "index.json"), "utf8")).toBe("2");
  expect(existsSync(`${target}.old`)).toBe(false);
  expect(existsSync(second)).toBe(false);
});

test("delivery.json keeps the other parts and refuses another version", async () => {
  const delivery = {
    version: "0.0.0-abc1234",
    desktopVersion: "0.0.0",
    commit: "abc1234",
    dirty: false,
    folder,
  };
  await common.recordPart(delivery, "plugins", { files: [] });
  const manifest = await common.recordPart(delivery, "vera-windows-x64", { files: [] });
  expect(Object.keys(manifest.parts)).toEqual(["plugins", "vera-windows-x64"]);
  expect(manifest.parts.plugins).toMatchObject({ version: "0.0.0-abc1234", commit: "abc1234" });
  await expect(common.recordPart({ ...delivery, version: "0.0.0-def5678" }, "plugins", {})).rejects.toThrow(
    /0.0.0-abc1234/,
  );
});

test("a delivery warns about unsigned installers, mixed commits and a dirty tree without failing", () => {
  const part = (commit: string, extra = {}) => ({ version: "1.0.0", commit, dirty: false, ...extra });
  expect(
    common.deliveryWarnings({
      parts: {
        plugins: part("abc1234", { signed: true }),
        "vera-linux-x64": part("abc1234", { signing: "not-applicable" }),
        "vera-windows-x64": part("abc1234", { signing: "requested" }),
      },
    }),
  ).toEqual([]);
  expect(
    common.deliveryWarnings({
      parts: {
        plugins: part("abc1234", { dirty: true }),
        "vera-windows-x64": part("def5678", { signing: "unsigned" }),
      },
    }),
  ).toEqual([
    "vera-windows-x64: the installers are not code-signed",
    "the parts were built from different commits: plugins abc1234, vera-windows-x64 def5678",
    "built from a tree with uncommitted changes: plugins",
  ]);
  expect(common.deliveryWarnings(undefined)).toEqual([]);
});

test("zipFiles stores the files under the prefix", async () => {
  await mkdir(join(folder, "kit/files"), { recursive: true });
  await writeFile(join(folder, "kit/kit.json"), "{}");
  await writeFile(join(folder, "kit/files/tool.bin"), "binary");
  const names = await common.listTree(join(folder, "kit"));
  expect(names).toEqual(["files/tool.bin", "kit.json"]);
  await common.zipFiles(join(folder, "kit"), names, join(folder, "kit.zip"), "vera-kit");
  const { unzipSync } = await import("fflate");
  const entries = unzipSync(new Uint8Array(await readFile(join(folder, "kit.zip"))));
  expect(Object.keys(entries).sort()).toEqual(["vera-kit/files/tool.bin", "vera-kit/kit.json"]);
  expect(Buffer.from(entries["vera-kit/files/tool.bin"] ?? []).toString()).toBe("binary");
});

test("delivery rejects altered or missing inner model members even when archive checksums match", async () => {
  const { checkEmbeddingPayload } = await import(
    /* @vite-ignore */ pathToFileURL(`${process.cwd()}/../02_Tools/release/embedding-payload.mjs`).href
  );
  const { unzipSync } = await import("fflate");
  const asset = "resources/models/Xenova/multilingual-e5-small/tokenizer.json";
  const original = Buffer.from("original");
  const pinned = [
    { path: asset, bytes: original.length, sha256: createHash("sha256").update(original).digest("hex") },
  ];
  const archive = join(folder, "models.zip");
  const write = async (value: string) => {
    await writeFile(join(folder, "asset"), value);
    await common.zipFiles(folder, ["asset"], archive);
    await rm(join(folder, "asset"));
    await common.writeSums(folder, [await common.describeFile(folder, "models.zip")]);
    expect(await common.checkSums(folder)).toEqual([]);
  };
  const check = async () => {
    const entries = unzipSync(new Uint8Array(await readFile(archive)));
    return checkEmbeddingPayload(pinned, (path: string) =>
      entries.asset && path === asset ? Buffer.from(entries.asset) : Buffer.alloc(0),
    );
  };
  await write("original");
  await expect(check()).resolves.toBeUndefined();
  await write("tampered");
  await expect(check()).rejects.toThrow(asset);
  await common.zipFiles(folder, [], archive);
  await expect(check()).rejects.toThrow(asset);
});

test("release notes Markdown lists entries by category in English and says when there are none", () => {
  const entry = (category: string, en: string) => ({ category, topic: { en: "Plugins" }, text: { en } });
  expect(
    common.formatReleaseNotes(
      { date: "2026-11-15", entries: [entry("fixed", "Fix."), entry("new", "New.")] },
      "0.1.0",
    ),
  ).toBe(
    "# VERA 0.1.0 release notes\n\n2026-11-15\n\n## New\n\n- **Plugins:** New.\n\n## Fixed\n\n- **Plugins:** Fix.\n\n" +
      "Settings > About > What's new shows these notes in the interface language.\n",
  );
  expect(common.formatReleaseNotes({ date: null, entries: [] }, "0.1.1")).toContain(
    "No user-visible changes.",
  );
});
