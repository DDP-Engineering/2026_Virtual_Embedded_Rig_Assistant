import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

async function digest(paths) {
  const hash = createHash("sha256");
  async function visit(path) {
    hash.update(path);
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return hash.update("missing");
      if (error.code !== "ENOTDIR") throw error;
      hash.update(await readFile(path));
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (["node_modules", "dist", "out", "bundled-plugins"].includes(entry.name)) continue;
      if (/\.(?:test|spec)\.[cm]?[jt]sx?$|\.tsbuildinfo$/.test(entry.name)) continue;
      if (entry.isSymbolicLink()) throw Error(`Unsupported build input link: ${join(path, entry.name)}`);
      await visit(join(path, entry.name));
    }
  }
  for (const path of paths) await visit(path);
  return hash.digest("hex");
}

/** Reuse only the exact source/environment build with unchanged output bytes. */
export async function ensureDesktopTestBuild(root, env, build) {
  const output = env.VERA_BUILD_ROOT ? resolve(env.VERA_BUILD_ROOT) : join(root, "src/apps/desktop/out");
  const inputs = [
    "package.json",
    "package-lock.json",
    "src/apps/desktop",
    "src/libraries/core",
    "src/libraries/shared",
    "help",
    "release-notes",
    ".env",
    ".env.local",
    ".env.production",
    ".env.production.local",
    "../LICENSE.txt",
    "../REUSE.toml",
    "../02_Tools/release",
  ].map((path) => join(root, path));
  const variables = Object.fromEntries(
    Object.entries(env)
      .filter(([key]) => /^(?:VERA_|VITE_|NODE_ENV)/.test(key))
      .sort(),
  );
  const sources = await digest(inputs);
  const input = createHash("sha256")
    .update(sources)
    .update(JSON.stringify(variables))
    .update(`${process.version}:${process.platform}:${process.arch}`)
    .update(output)
    .digest("hex");
  const directory = join(root, "node_modules/.cache/test-builds");
  const recordPath = join(directory, "desktop.json");
  let record;
  try {
    record = JSON.parse(await readFile(recordPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  if (record?.input === input && record.output === (await digest([output]))) return "reused";
  await build();
  // Do not certify a candidate edited while its build was running.
  if ((await digest(inputs)) !== sources) throw Error("Build inputs changed");
  for (const file of ["main/index.js", "preload/index.cjs", "renderer/index.html"])
    await readFile(join(output, file));
  await mkdir(directory, { recursive: true });
  await writeFile(recordPath, JSON.stringify({ input, output: await digest([output]) }));
  return "built";
}
