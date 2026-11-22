import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The 05_Software folder: evaluators/shared/ is two levels below it. */
export const software = fileURLToPath(new URL("../../", import.meta.url));

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/**
 * Hash of the harness code only: the top-level *.mjs files of each folder. README.md, cases/ and
 * baselines/ live in the same folders and must not change the identity of a harness.
 */
export async function harnessHash(folders) {
  const parts = [];
  for (const folder of folders) {
    const names = (await readdir(folder)).filter((name) => name.endsWith(".mjs")).sort();
    for (const name of names)
      parts.push([`${basename(folder)}/${name}`, sha256(await readFile(join(folder, name)))]);
  }
  return sha256(JSON.stringify(parts));
}

/** The VERA commit and whether the working tree differs from it (ignored files do not count). */
export function gitState(cwd = software) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  try {
    return { commit: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain").length > 0 };
  } catch {
    return { commit: null, dirty: null };
  }
}

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "run";

/** `<YYYYMMDD-HHMMSS>-<label>`, in local time, as the folder name of one run. */
export function runId(label, now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${stamp}-${slug(label)}`;
}

/** evaluation-outputs/<family>/<run-id>/run.json */
export const defaultRunPath = (family, label) =>
  join(software, "evaluation-outputs", family, runId(label), "run.json");

/** The HTML report beside a run: report.html next to run.json, otherwise <name>.html. */
export const reportPathFor = (runPath) =>
  basename(runPath) === "run.json"
    ? join(dirname(runPath), "report.html")
    : `${runPath.replace(/\.json$/i, "")}.html`;
