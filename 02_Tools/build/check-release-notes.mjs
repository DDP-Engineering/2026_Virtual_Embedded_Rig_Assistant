import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importSoftware, software } from "../environment/software.mjs";

const { parse } = await importSoftware("yaml");

export const languages = ["en", "ro", "de", "fr"];
export const categories = ["new", "improved", "fixed"];
export const limits = { text: 100, topic: 40, perCategory: 10 };
// File names, paths, code identifiers and REQ/TASK ids do not belong in user language.
const technical =
  /`|\bREQ-[A-Z]+-|\bTASK-|\b[\w-]+\.(?:tsx?|mjs|js|json|ya?ml|md|py|toml)\b|[\\/][\w.-]+[\\/]/;

const versionOf = (file) => (file === "unreleased.yaml" ? "Unreleased" : file.replace(/\.yaml$/, ""));

function checkTexts(where, value, max, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${where}: needs ${languages.join(", ")}`);
    return;
  }
  const extra = Object.keys(value).filter((key) => !languages.includes(key));
  if (extra.length) errors.push(`${where}: unknown language ${extra.join(", ")}`);
  for (const language of languages) {
    const text = value[language];
    if (typeof text !== "string" || !text.trim()) errors.push(`${where}.${language}: missing`);
    else {
      if ([...text].length > max) errors.push(`${where}.${language}: longer than ${max} characters`);
      if (technical.test(text)) errors.push(`${where}.${language}: contains a file name, path or id`);
    }
  }
}

/** Errors of one release-notes document named `file`; an empty list means valid. */
export function checkReleaseNotes(file, document) {
  const errors = [];
  const expected = versionOf(file);
  if (!document || typeof document !== "object") return [`${file}: not a YAML mapping`];
  const keys = Object.keys(document).filter((key) => !["version", "date", "entries"].includes(key));
  if (keys.length) errors.push(`${file}: unknown field ${keys.join(", ")}`);
  if (String(document.version) !== expected) errors.push(`${file}: version must be ${expected}`);
  const date = document.date instanceof Date ? document.date.toISOString().slice(0, 10) : document.date;
  if (expected === "Unreleased" ? date !== null : !/^\d{4}-\d{2}-\d{2}$/.test(String(date)))
    errors.push(`${file}: date must be ${expected === "Unreleased" ? "null" : "YYYY-MM-DD"}`);
  if (!Array.isArray(document.entries)) return [...errors, `${file}: entries must be a list`];
  const counts = Object.fromEntries(categories.map((category) => [category, 0]));
  document.entries.forEach((entry, index) => {
    const where = `${file} entry ${index + 1}`;
    if (!categories.includes(entry?.category))
      errors.push(`${where}: category must be ${categories.join(" | ")}`);
    else counts[entry.category]++;
    checkTexts(`${where} topic`, entry?.topic, limits.topic, errors);
    checkTexts(`${where} text`, entry?.text, limits.text, errors);
  });
  for (const [category, count] of Object.entries(counts))
    if (count > limits.perCategory)
      errors.push(`${file}: ${count} ${category} entries, at most ${limits.perCategory}`);
  return errors;
}

/** True when CHANGELOG.md has uncommitted or staged changes but release-notes/ has none. */
function changelogWithoutNotes(root) {
  // Without Git (stdout is null) nothing counts as changed: the notes themselves are still checked.
  const changed = (path) =>
    (
      spawnSync("git", ["status", "--porcelain", "--", path], { cwd: root, encoding: "utf8" }).stdout ?? ""
    ).trim() !== "";
  return changed("../CHANGELOG.md") && !changed("release-notes");
}

export async function auditReleaseNotes(root = software) {
  const folder = join(root, "release-notes");
  const files = (await readdir(folder)).filter((name) => name.endsWith(".yaml")).sort();
  const errors = [];
  if (!files.includes("unreleased.yaml")) errors.push("release-notes/unreleased.yaml is missing");
  for (const file of files) {
    if (file !== "unreleased.yaml" && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.yaml$/.test(file))
      errors.push(`${file}: name must be unreleased.yaml or <version>.yaml`);
    else errors.push(...checkReleaseNotes(file, parse(await readFile(join(folder, file), "utf8"))));
  }
  return { files, errors, warning: changelogWithoutNotes(root) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { files, errors, warning } = await auditReleaseNotes();
  for (const error of errors) console.error(`error: ${error}`);
  if (warning)
    console.warn(
      "warning: CHANGELOG.md changed without release notes; add an entry or confirm none is user-visible",
    );
  console.log(`Release notes: ${files.length} file(s), ${errors.length} error(s).`);
  process.exitCode = errors.length ? 1 : 0;
}
