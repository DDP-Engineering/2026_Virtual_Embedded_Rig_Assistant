import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";

const tools = `${process.cwd()}/../02_Tools`;
const release = await import(
  /* @vite-ignore */ pathToFileURL(`${tools}/delivery/publish-github-release.mjs`).href
);
const config = await import(/* @vite-ignore */ pathToFileURL(`${tools}/release/update-config.mjs`).href);
const feed = config.releaseFeed();
let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "vera-release-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

test("the release feed is the latest-release download folder of the public repository", () => {
  expect(feed).toBe(
    "https://github.com/DDP-Engineering/2026_Virtual_Embedded_Rig_Assistant/releases/latest/download/",
  );
  // The build accepts it unchanged as the fixed update feed.
  expect(config.updateFeed(feed)).toBe(feed);
  expect(() => config.releaseFeed("owner/repo/../other")).toThrow();
  expect(release.releaseTag("1.2.0")).toBe("v1.2.0");
  expect(release.isPrerelease("1.2.0")).toBe(false);
  expect(release.isPrerelease("1.3.0-beta.1")).toBe(true);
});

test("only a versioned, clean delivery of both installers built for this feed and commit is released", () => {
  const part = (extra = {}) => ({ commit: "abc1234", dirty: false, updateFeed: feed, ...extra });
  const manifest = (parts: Record<string, unknown>, version = "1.2.0") => ({ version, parts });
  const both = { "vera-linux-x64": part(), "vera-windows-x64": part() };
  expect(release.releaseProblems(manifest(both), feed)).toEqual([]);
  expect(release.releaseProblems(undefined, feed)).toEqual(["delivery.json missing"]);
  expect(release.releaseProblems(manifest(both, "0.0.0-abc1234"), feed)).toEqual([
    "0.0.0-abc1234 is a development delivery; give the desktop package a version first",
  ]);
  expect(release.releaseProblems(manifest({ "vera-windows-x64": part() }), feed)).toEqual([
    "vera-linux-x64: missing",
  ]);
  expect(
    release.releaseProblems(
      manifest({
        "vera-linux-x64": part({ commit: "def5678", dirty: true }),
        "vera-windows-x64": part({ updateFeed: "" }),
      }),
      feed,
    ),
  ).toEqual([
    `vera-windows-x64: built for update feed (none), not ${feed}`,
    "vera-linux-x64: built from a tree with uncommitted changes",
    "the installers were built from different commits: vera-windows-x64 abc1234, vera-linux-x64 def5678",
  ]);
});

test("the release carries the desktop and plugin files and the license, but not the parts' sums and notes", async () => {
  const put = async (path: string) => {
    await mkdir(join(folder, path, ".."), { recursive: true });
    await writeFile(join(folder, path), path);
  };
  for (const path of [
    "vera-windows-x64/VERA-1.2.0-win-x64.exe",
    "vera-windows-x64/VERA-1.2.0-win-x64.exe.blockmap",
    "vera-windows-x64/latest.yml",
    "vera-windows-x64/SHA256SUMS",
    "vera-windows-x64/RELEASE-NOTES.md",
    "vera-linux-x64/VERA-1.2.0-linux-amd64.deb",
    "vera-linux-x64/latest-linux.yml",
    "vera-linux-x64/SHA256SUMS",
    "plugins/vera-plugins-1.2.0.zip",
    "plugins/index.json",
    "plugin-deps/vera-plugin-deps-1.2.0-linux-x64.zip",
    "LICENSE.txt",
  ])
    await put(path);
  const assets = await release.releaseAssets(folder, "1.2.0", join(folder, "LICENSE.txt"));
  expect(assets.map((asset: { name: string }) => asset.name)).toEqual([
    "LICENSE.txt",
    "VERA-1.2.0-linux-amd64.deb",
    "VERA-1.2.0-win-x64.exe",
    "VERA-1.2.0-win-x64.exe.blockmap",
    "latest-linux.yml",
    "latest.yml",
    "vera-plugin-deps-1.2.0-linux-x64.zip",
    "vera-plugins-1.2.0.zip",
  ]);
  await put("vera-linux-x64/latest.yml");
  await expect(release.releaseAssets(folder, "1.2.0", join(folder, "LICENSE.txt"))).rejects.toThrow(
    "latest.yml is in the delivery twice",
  );
});

test("the release includes the offline component archives and their licence notices", async () => {
  const components = join(folder, "components");
  for (const part of [...release.desktopParts, "components"]) await mkdir(join(folder, part));
  const names = [
    "THIRD-PARTY-NOTICES.md",
    "chrome-linux64.zip",
    "chrome-win64.zip",
    "whisper-base.zip",
    "whisper-small.zip",
  ];
  for (const name of [...names, "SHA256SUMS"]) await writeFile(join(components, name), name);
  const license = join(folder, "LICENSE.txt");
  await writeFile(license, "VERA licence");

  expect(await release.releaseAssets(folder, "1.2.0", license)).toEqual([
    { name: "LICENSE.txt", path: license },
    ...names.map((name) => ({ name, path: join(components, name) })),
  ]);
});

test("the release text keeps the notes' sections and describes every download", () => {
  const notes = release.notesSections(
    "# VERA 0.3.0 release notes\r\n\r\n2026-11-21\r\n\r\n## New\r\n\r\n- **Chat:** Images.\r\n\r\n" +
      "Settings > About > What's new shows these notes in the interface language.\r\n",
  );
  expect(notes).toBe("## New\n\n- **Chat:** Images.");
  const body = release.releaseBody({
    version: "0.3.0",
    notes,
    names: [
      "InRelease",
      "LICENSE.txt",
      "Packages",
      "Packages.gz",
      "Release",
      "Release.gpg",
      "SHA256SUMS",
      "THIRD-PARTY-NOTICES.md",
      "VERA-0.3.0-linux-amd64.deb",
      "VERA-0.3.0-win-x64.exe",
      "VERA-0.3.0-win-x64.exe.blockmap",
      "chrome-linux64.zip",
      "chrome-win64.zip",
      "latest-linux.yml",
      "latest.yml",
      "vera-archive-keyring.gpg",
      "vera-plugins-0.3.0.zip",
      "whisper-base.zip",
      "whisper-small.zip",
    ],
    plugins: 43,
    commit: "abc1234",
    unsigned: true,
    catalogUnsigned: true,
  });
  expect(body).toContain("Pre-release of VERA.");
  expect(body).toContain("## New\n\n- **Chat:** Images.\n\n## Downloads");
  expect(body).toContain("| `VERA-0.3.0-win-x64.exe` | Windows x64 installer (per user, no admin rights) |");
  expect(body).toContain("| `vera-plugins-0.3.0.zip` | the 43 official plugins as a catalog release");
  expect(body).toContain("| `chrome-linux64.zip`, `chrome-win64.zip` | Chromium for offline installation");
  expect(body).toContain(
    "| `whisper-base.zip`, `whisper-small.zip` | Whisper models for offline installation",
  );
  expect(body).toContain("| `THIRD-PARTY-NOTICES.md` | sources and licences for the offline components |");
  expect(body).toContain(
    "| `VERA-0.3.0-win-x64.exe.blockmap`, `latest-linux.yml`, `latest.yml` | the update feed:",
  );
  expect(body).toContain(
    "| `InRelease`, `Packages`, `Packages.gz`, `Release`, `Release.gpg`, `vera-archive-keyring.gpg` | the apt repository",
  );
  expect(body).toContain(
    "Windows binaries are not code-signed (SmartScreen warns). Built from commit abc1234.",
  );
  expect(body).not.toContain("portable |");
  const stable = release.releaseBody({
    version: "1.0.0",
    notes: "No user-visible changes.",
    names: ["SHA256SUMS"],
    commit: "abc1234",
    unsigned: false,
    catalogUnsigned: false,
  });
  expect(stable).not.toContain("Pre-release");
  expect(stable).not.toContain("signed");
});

test("uploaded assets must match the local files by name, size and digest, with nothing extra", () => {
  const sha256 = "a".repeat(64);
  const local = [{ name: "latest.yml", bytes: 10, sha256 }];
  const asset = (extra = {}) => ({
    name: "latest.yml",
    size: 10,
    state: "uploaded",
    digest: `sha256:${sha256}`,
    ...extra,
  });
  expect(release.assetProblems(local, [asset()])).toEqual([]);
  // Older releases report no digest; the size still has to match.
  expect(release.assetProblems(local, [asset({ digest: undefined })])).toEqual([]);
  expect(release.assetProblems(local, [])).toEqual(["latest.yml: not uploaded"]);
  expect(release.assetProblems(local, [asset({ state: "starter" })])).toEqual(["latest.yml: upload starter"]);
  expect(release.assetProblems(local, [asset({ size: 9 })])).toEqual(["latest.yml: size 9, expected 10"]);
  expect(release.assetProblems(local, [asset({ digest: `sha256:${"b".repeat(64)}` })])).toEqual([
    "latest.yml: SHA-256 differs",
  ]);
  expect(release.assetProblems(local, [asset(), { name: "old.exe", size: 1 }])).toEqual([
    "old.exe: not part of this delivery",
  ]);
});

test("the feed check reads the channel file's version past the cache and treats failures as not yet", async () => {
  const requested: string[] = [];
  const fetcher = async (url: URL) => {
    requested.push(url.href);
    return url.pathname.endsWith("/latest.yml")
      ? new Response("version: 1.2.0\nfiles: []\n")
      : new Response("Not Found", { status: 404 });
  };
  expect(await release.feedVersion(feed, "latest.yml", fetcher)).toBe("1.2.0");
  expect(requested[0]).toMatch(/\/releases\/latest\/download\/latest\.yml\?noCache=/);
  expect(await release.feedVersion(feed, "latest-linux.yml", fetcher)).toBeUndefined();
  const offline = async () => {
    throw new Error("offline");
  };
  expect(await release.feedVersion(feed, "latest.yml", offline)).toBeUndefined();
});
