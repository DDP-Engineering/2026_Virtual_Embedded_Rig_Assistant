import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DependencyKitPlatform, DependencyKitTools } from "@vera/core";
import { pluginPlatform } from "@vera/shared";

/** The pip that downloads resolved wheels; the pinned uv runs it, so a kit build needs no Python of its own. */
export const KIT_PIP = "pip==26.1.2";
/**
 * manylinux_2_28 and every older manylinux tag, best first: pip matches `--platform` tags exactly, so a wheel
 * tagged only manylinux2014 needs its own entry. The bench needs glibc 2.28 or newer.
 */
const MANYLINUX = [
  ...Array.from({ length: 24 }, (_, index) => `manylinux_2_${28 - index}_x86_64`),
  "manylinux2014_x86_64",
  "manylinux2010_x86_64",
  "manylinux1_x86_64",
];
/** uv's resolver platform, pip's wheel platforms and uv's CPython listing of each kit platform. */
const TARGETS = {
  "windows-x64": { resolve: "x86_64-pc-windows-msvc", wheels: ["win_amd64"], os: "windows", libc: "none" },
  "linux-x64": { resolve: "x86_64-manylinux_2_28", wheels: MANYLINUX, os: "linux", libc: "gnu" },
} as const;

/** Runs the pinned uv without user configuration; rejects with the end of its output. */
function run(executable: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        // A fixed source date: a wheel built from a source package gets the same bytes on every build.
        env: { ...process.env, UV_NO_CONFIG: "1", UV_NO_PROGRESS: "1", SOURCE_DATE_EPOCH: "315532800" },
        maxBuffer: 64 * 1024 ** 2,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        const output = `${stderr}${stdout}`.trim().split(/\r?\n/).slice(-12).join("\n");
        reject(new Error(output || error.message));
      },
    );
  });
}

/** pip on CPython 3.13 (the managed Python of every plugin), run by the pinned uv. */
const pip = (uv: string, args: readonly string[]) =>
  run(uv, [
    "tool",
    "run",
    "--python",
    "3.13",
    "--from",
    KIT_PIP,
    "pip",
    ...args,
    "--quiet",
    "--disable-pip-version-check",
    "--no-cache-dir",
  ]);

/**
 * The kit build's tools over the pinned uv (spec REQ-DATA-532b02f5): `uv pip compile` resolves a program's
 * requirements for CPython 3.13 on the kit platform with that platform's markers, pip downloads exactly those
 * files with the resolved hashes (a wheel where one fits), a requirement published only as source is built here
 * into a wheel (a bench never builds): a pure Python one on any build host, a compiled one only on the kit's own
 * platform. `uv python list` names the CPython archive this uv installs.
 */
export function cliKitTools(uv: string): DependencyKitTools {
  return {
    fetch: (url, { signal }) => fetch(url, signal ? { signal } : {}),
    async wheels(platform: DependencyKitPlatform, input, folder) {
      const target = TARGETS[platform];
      // Beside the wheel folder, inside the kit's staging folder: same drive for rename, removed with it.
      const work = await mkdtemp(join(dirname(folder), ".wheels-"));
      try {
        let source: string;
        if ("requirement" in input) {
          source = join(work, "requirements.in");
          await writeFile(source, `${input.requirement}\n`);
        } else source = input.script;
        const pinned = join(work, "requirements.txt");
        await run(uv, [
          "pip",
          "compile",
          source,
          "--python-platform",
          target.resolve,
          "--python-version",
          "3.13",
          "--generate-hashes",
          "--no-header",
          "--no-annotate",
          "--quiet",
          "--output-file",
          pinned,
        ]);
        // A script that uses the standard library only resolves to nothing.
        if (!/^[A-Za-z0-9]/m.test(await readFile(pinned, "utf8"))) return;
        const downloaded = join(work, "downloaded");
        await pip(uv, [
          "download",
          "--no-deps",
          "--prefer-binary",
          ...target.wheels.flatMap((tag) => ["--platform", tag]),
          "--python-version",
          "3.13",
          "--implementation",
          "cp",
          "--abi",
          "cp313",
          "--abi",
          "abi3",
          "--abi",
          "none",
          "--require-hashes",
          "--requirement",
          pinned,
          "--dest",
          downloaded,
        ]);
        const built = join(work, "built");
        await mkdir(built);
        for (const name of await readdir(downloaded)) {
          if (name.endsWith(".whl")) {
            await rename(join(downloaded, name), join(folder, name));
            continue;
          }
          await pip(uv, ["wheel", "--no-deps", "--wheel-dir", built, join(downloaded, name)]);
          for (const wheel of await readdir(built)) {
            // Built on this computer with CPython 3.13: compiled code fits only this platform's kit.
            if (
              !wheel.endsWith("-none-any.whl") &&
              pluginPlatform(process.platform, process.arch) !== platform
            )
              throw new Error(
                `${name} has no wheel for ${platform} and builds only as ${wheel} here; build this kit on ${platform}`,
              );
            await rename(join(built, wheel), join(folder, wheel));
          }
        }
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    },
    async python(platform) {
      const target = TARGETS[platform];
      const listed = JSON.parse(
        await run(uv, [
          "python",
          "list",
          "3.13",
          "--only-downloads",
          "--all-platforms",
          "--output-format",
          "json",
        ]),
      ) as {
        url?: string | null;
        os: string;
        arch: string;
        libc: string;
        implementation: string;
        variant: string;
        version_parts: { patch: number };
      }[];
      const newest = listed
        .filter(
          (entry) =>
            entry.url &&
            entry.implementation === "cpython" &&
            entry.variant === "default" &&
            entry.os === target.os &&
            entry.arch === "x86_64" &&
            entry.libc === target.libc,
        )
        .sort((a, b) => b.version_parts.patch - a.version_parts.patch)[0];
      if (!newest?.url) throw new Error(`uv lists no CPython 3.13 download for ${platform}`);
      return newest.url;
    },
  };
}
