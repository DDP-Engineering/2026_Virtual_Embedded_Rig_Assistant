import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const tools = `${process.cwd()}/../02_Tools`;
const apt = await import(/* @vite-ignore */ pathToFileURL(`${tools}/delivery/apt-repository.mjs`).href);
const deb = "VERA-1.1.0-linux-amd64.deb";
const control = [
  "Package: vera-apt-probe",
  "Version: 1.1.0",
  "Architecture: amd64",
  "Maintainer: VERA test <test@vera.invalid>",
  "Installed-Size: 1",
  "Description: VERA apt repository probe",
  " A package that only proves the repository.",
  "",
].join("\n");

// Real gpg signs and real gpgv verifies: Git for Windows ships both, Linux has them on PATH.
const windowsGit = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "usr", "bin");
const gpg = process.platform === "win32" ? join(windowsGit, "gpg.exe") : "gpg";
const gpgv = apt.findGpgv();
const runs = (command: string) => spawnSync(command, ["--version"]).status === 0;
const signing = runs(gpg) && Boolean(gpgv);
let root: string;
const keys: Record<"own" | "other" | "expired", string> = { own: "", other: "", expired: "" };
// Before the expiry of the "expired" key, which gpg creates in that past.
const past = ["--faked-system-time", "20200101T120000"];

/** A throwaway key in its own GnuPG home; paths stay relative because MSYS gpg reads C:\ paths as relative. */
function makeKey(home: string, user: string, expiry = "never", time: string[] = []) {
  const run = (args: string[]) => {
    const result = spawnSync(gpg, ["--homedir", home, "--batch", ...args], { cwd: root });
    if (result.status !== 0) throw new Error(String(result.stderr));
    return String(result.stdout);
  };
  run([
    ...time,
    "--pinentry-mode",
    "loopback",
    "--passphrase",
    "",
    "--quick-gen-key",
    user,
    "ed25519",
    "sign",
    expiry,
  ]);
  const fpr = run(["--with-colons", "--list-secret-keys", user])
    .split("\n")
    .find((line) => line.startsWith("fpr:"));
  return fpr?.split(":")[9] ?? "";
}

/** A Linux part folder with a deb and its repository, signed by `key`. */
async function part(name: string, home = "../own", key = keys.own, bytes = "deb bytes 1.1.0") {
  const folder = join(root, name);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, deb), bytes);
  const result = await apt.buildAptRepository({
    folder,
    deb,
    key,
    control,
    gpg,
    gnupgHome: home,
    date: new Date("2026-11-21T10:00:00Z"),
  });
  return { folder, result, files: [deb, ...apt.aptFiles] };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-apt-"));
  if (!signing) return;
  await mkdir(join(root, "own"), { mode: 0o700 });
  await mkdir(join(root, "other"), { mode: 0o700 });
  await mkdir(join(root, "expired"), { mode: 0o700 });
  keys.own = makeKey("own", "VERA test <test@vera.invalid>");
  // A maintainer's gpg.conf may armor every output; the keyring must stay binary.
  await writeFile(join(root, "own", "gpg.conf"), "armor\n");
  keys.other = makeKey("other", "Someone else <else@vera.invalid>");
  keys.expired = makeKey("expired", "Expired <old@vera.invalid>", "1d", past);
}, 60_000);
afterAll(async () => {
  for (const home of ["own", "other", "expired"])
    spawnSync(gpg.replace(/gpg(\.exe)?$/, "gpgconf$1"), ["--homedir", home, "--kill", "gpg-agent"], {
      cwd: root,
    });
  await rm(root, { recursive: true, force: true });
});

test("the Packages entry is the deb's control plus its file name, size and SHA-256", () => {
  const entry = apt.packagesEntry(control, { name: deb, bytes: 15, sha256: "a".repeat(64) });
  expect(entry).toBe(`${control.trimEnd()}\nFilename: ${deb}\nSize: 15\nSHA256: ${"a".repeat(64)}\n`);
  expect(apt.parseStanzas(entry)).toEqual([
    expect.objectContaining({
      Package: "vera-apt-probe",
      Description: "VERA apt repository probe\n A package that only proves the repository.",
      Filename: deb,
      Size: "15",
    }),
  ]);
  expect(() => apt.packagesEntry("Description: none\n", { name: deb, bytes: 1, sha256: "" })).toThrow();
  const release = apt.releaseText(new Date("2026-11-21T10:00:00Z"), "amd64", [
    { name: "Packages", bytes: 10, sha256: "b".repeat(64) },
  ]);
  expect(release).toContain("Date: Sat, 21 Nov 2026 10:00:00 UTC\n");
  expect(release).toContain("Architectures: amd64\n");
  expect(apt.releaseHashes(release).get("Packages")).toEqual({ bytes: 10, sha256: "b".repeat(64) });
  expect(apt.isAptFile("InRelease")).toBe(true);
  expect(apt.isAptFile(deb)).toBe(false);
  // Only the Linux part has a deb, so only it reads VERA_APT_KEY; without the variable there is no repository.
  expect(apt.aptKeyFor("linux-x64", { VERA_APT_KEY: "ABC" })).toBe("ABC");
  expect(apt.aptKeyFor("linux-x64", {})).toBe("");
  expect(apt.aptKeyFor("windows-x64", { VERA_APT_KEY: "ABC" })).toBe("");
});

describe.runIf(signing)("with gpg", () => {
  test("builds a flat repository signed by the key, and verify accepts it", async () => {
    const { folder, result, files } = await part("good");
    expect(result.fingerprint).toBe(keys.own);
    const packages = await readFile(join(folder, "Packages"));
    expect(gunzipSync(await readFile(join(folder, "Packages.gz"))).equals(packages)).toBe(true);
    expect(String(packages)).toContain(`Filename: ${deb}\nSize: 15\n`);
    expect(String(await readFile(join(folder, "InRelease")))).toContain("-----BEGIN PGP SIGNED MESSAGE-----");
    // Binary, not "-----BEGIN PGP PUBLIC KEY BLOCK-----", although this GnuPG home armors by default.
    expect((await readFile(join(folder, apt.keyringName)))[0]).not.toBe("-".charCodeAt(0));
    expect(await apt.checkAptRepository(folder, files, { fingerprint: keys.own, gpgv })).toEqual([]);
    expect(await apt.checkAptRepository(folder, files, { fingerprint: keys.other, gpgv })).toEqual([
      `InRelease: signed by ${keys.own}, not by the recorded key ${keys.other}`,
      `Release.gpg: signed by ${keys.own}, not by the recorded key ${keys.other}`,
    ]);
    // A part without repository files has nothing to check here; the delivery warns instead.
    expect(await apt.checkAptRepository(folder, [deb], { fingerprint: "", gpgv })).toEqual([]);
  }, 60_000);

  test("verify reports a changed deb, a changed index, a missing file, another deb and another signer", async () => {
    const check = (folder: string, files: string[]) =>
      apt.checkAptRepository(folder, files, { fingerprint: keys.own, gpgv });
    const changedDeb = await part("changed-deb");
    await writeFile(join(changedDeb.folder, deb), "deb bytes 1.1.1");
    expect(await check(changedDeb.folder, changedDeb.files)).toEqual([
      `Packages: size or SHA-256 of ${deb} differs`,
    ]);

    const changedIndex = await part("changed-index");
    const packages = join(changedIndex.folder, "Packages");
    await writeFile(
      packages,
      String(await readFile(packages)).replace("Installed-Size: 1", "Installed-Size: 2"),
    );
    expect(await check(changedIndex.folder, changedIndex.files)).toEqual([
      "Release: Packages size or SHA-256 differs",
      "Packages.gz: not the compressed Packages",
    ]);

    const missing = await part("missing");
    await rm(join(missing.folder, "InRelease"));
    expect(
      await check(
        missing.folder,
        missing.files.filter((name) => name !== "InRelease"),
      ),
    ).toEqual(["apt repository incomplete: InRelease missing"]);

    const renamed = await part("renamed");
    const other = "VERA-1.1.0-linux-other.deb";
    await copyFile(join(renamed.folder, deb), join(renamed.folder, other));
    await rm(join(renamed.folder, deb));
    expect(await check(renamed.folder, [other, ...apt.aptFiles])).toEqual([
      `Packages: names ${deb}, not ${other}`,
    ]);

    // Another key re-signs the same Release: the part's keyring no longer verifies it.
    const resigned = await part("resigned");
    const foreign = await part("foreign", "../other", keys.other);
    for (const name of ["InRelease", "Release.gpg"])
      await copyFile(join(foreign.folder, name), join(resigned.folder, name));
    // gpgv's reason follows in parentheses.
    expect(await check(resigned.folder, resigned.files)).toEqual([
      expect.stringMatching(
        /^InRelease: the signature does not verify with vera-archive-keyring\.gpg \(.+\)$/,
      ),
      expect.stringMatching(
        /^Release\.gpg: the signature does not verify with vera-archive-keyring\.gpg \(.+\)$/,
      ),
    ]);
  }, 120_000);

  test("an expired key cannot sign a repository, and a signature it made does not pass", async () => {
    expect(() => apt.signingKey(keys.expired, { gpg, gnupgHome: "expired", cwd: root })).toThrow();
    expect(apt.signingKey(keys.own, { gpg, gnupgHome: "own", cwd: root })).toBe(keys.own);
    // Signed while the key was valid: gpgv still reports VALIDSIG, but apt refuses EXPKEYSIG.
    const { folder, files } = await part("expired-signature");
    const run = (args: string[]) => {
      const result = spawnSync(gpg, ["--homedir", "../expired", "--batch", ...past, ...args], {
        cwd: folder,
      });
      expect(result.status, String(result.stderr)).toBe(0);
      return result.stdout;
    };
    const sign = ["--yes", "--local-user", keys.expired, "--digest-algo", "SHA512"];
    run([...sign, "--clearsign", "--output", "InRelease", "Release"]);
    run([...sign, "--armor", "--detach-sign", "--output", "Release.gpg", "Release"]);
    await writeFile(join(folder, apt.keyringName), run(["--no-armor", "--export", keys.expired]));
    expect(await apt.checkAptRepository(folder, files, { fingerprint: keys.expired, gpgv })).toEqual([
      expect.stringMatching(/^InRelease: the signature does not verify/),
      expect.stringMatching(/^Release.gpg: the signature does not verify/),
    ]);
  }, 60_000);
});

// End to end on Linux: unprivileged apt with an older version "installed" reads the repository through a
// GitHub-like latest/download redirect, verifies it with the keyring, simulates the upgrade and downloads the deb.
const linuxApt =
  process.platform === "linux" &&
  signing &&
  runs("dpkg-deb") &&
  spawnSync("apt-get", ["--version"]).status === 0;
describe.runIf(linuxApt)("with apt", () => {
  test("apt upgrade moves an installed older version to the repository's deb", async () => {
    const build = async (version: string) => {
      const source = join(root, `pkg-${version}`);
      await mkdir(join(source, "DEBIAN"), { recursive: true });
      await mkdir(join(source, "opt/vera-apt-probe"), { recursive: true });
      await writeFile(join(source, "opt/vera-apt-probe/version"), version);
      await writeFile(join(source, "DEBIAN/control"), control.replace("1.1.0", version));
      const out = join(root, `VERA-${version}-linux-amd64.deb`);
      const made = spawnSync("dpkg-deb", ["--root-owner-group", "--build", source, out]);
      expect(made.status, String(made.stderr)).toBe(0);
      return out;
    };
    await build("1.0.0");
    const folder = join(root, "release");
    await mkdir(folder);
    await copyFile(await build("1.1.0"), join(folder, deb));
    // The real control, read from the deb by dpkg-deb.
    await apt.buildAptRepository({ folder, deb, key: keys.own, gpg, gnupgHome: "../own" });

    const server = createServer((request, response) => {
      const url = request.url ?? "";
      const name = url.split("/").pop() ?? "";
      if (url.startsWith("/releases/latest/download/")) {
        response.writeHead(302, { location: `/assets/${name}` }).end();
      } else if (url.startsWith("/assets/") && existsSync(join(folder, name))) {
        readFile(join(folder, name)).then((bytes) => response.writeHead(200).end(bytes));
      } else response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const state = join(root, "apt");
      for (const dir of ["lists/partial", "cache/archives/partial", "parts", "trusted", "download"])
        await mkdir(join(state, dir), { recursive: true });
      await writeFile(
        join(state, "status"),
        "Package: vera-apt-probe\nStatus: install ok installed\nVersion: 1.0.0\nArchitecture: amd64\nMaintainer: VERA test <test@vera.invalid>\nDescription: probe\n\n",
      );
      const feed = `http://127.0.0.1:${port}/releases/latest/download/`;
      await writeFile(
        join(state, "sources.list"),
        `deb [signed-by=${join(folder, apt.keyringName)}] ${feed} /\n`,
      );
      const options = [
        ["Dir::State", state],
        ["Dir::State::Lists", join(state, "lists")],
        ["Dir::State::status", join(state, "status")],
        ["Dir::Cache", join(state, "cache")],
        ["Dir::Etc::SourceList", join(state, "sources.list")],
        ["Dir::Etc::SourceParts", join(state, "parts")],
        ["Dir::Etc::Trusted", join(state, "trusted.gpg")],
        ["Dir::Etc::TrustedParts", join(state, "trusted")],
        ["Debug::NoLocking", "1"],
        ["APT::Sandbox::User", userInfo().username],
      ].flatMap(([key, value]) => ["-o", `${key}=${value}`]);
      // Asynchronous: this process also serves the repository.
      const aptGet = (args: string[], cwd = state) =>
        new Promise<{ status: number | null; output: string }>((resolve, reject) => {
          const child = spawn("apt-get", [...options, ...args], { cwd });
          let output = "";
          child.stdout.on("data", (chunk) => {
            output += chunk;
          });
          child.stderr.on("data", (chunk) => {
            output += chunk;
          });
          child.on("error", reject);
          child.on("close", (status) => resolve({ status, output }));
        });
      const ok = async (args: string[], cwd = state) => {
        const result = await aptGet(args, cwd);
        expect(result.status, result.output).toBe(0);
        // apt-get update exits 0 after failed fetches; warnings and errors fail the probe.
        expect(result.output).not.toMatch(/^(?:W|E|Err):/m);
        return result.output;
      };
      await ok(["update"]);
      expect(await ok(["-s", "upgrade"])).toMatch(/^Inst vera-apt-probe \[1\.0\.0\] \(1\.1\.0 /m);
      await ok(["download", "vera-apt-probe"], join(state, "download"));
      const fetched = await readFile(join(state, "download", "vera-apt-probe_1.1.0_amd64.deb"));
      expect(fetched.equals(await readFile(join(folder, deb)))).toBe(true);

      // A Release signed by another key is refused.
      const foreign = await part("foreign-apt", "../other", keys.other);
      for (const name of ["InRelease", "Release.gpg"])
        await copyFile(join(foreign.folder, name), join(folder, name));
      const refused = await aptGet(["update"]);
      expect(refused.output).toMatch(/NO_PUBKEY|not signed|signatures were invalid/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 180_000);
});
