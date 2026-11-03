import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { parseSkill, SkillCatalog } from "./catalog.js";

const roots: string[] = [];
it("uses only .vera project skills and denies a redirected metadata root", async () => {
  const f = await fixture();
  await mkdir(join(f.workbench, "skills/old"), { recursive: true });
  await writeFile(join(f.workbench, "skills/old/SKILL.md"), "old root content");
  expect((await f.catalog.list()).filter((s) => s.source !== "official")).toEqual([]);
  await rm(join(f.workbench, ".vera"), { recursive: true });
  await symlink(f.userData, join(f.workbench, ".vera"), process.platform === "win32" ? "junction" : "dir");
  await expect(f.catalog.list()).rejects.toMatchObject({ code: "DENIED" });
});
it("applies permanent ignores to both roots and workbench exclusions with negations", async () => {
  const f = await fixture();
  const workbenchDir = await f.skill("workbench", "reader"),
    userDir = await f.skill("user", "personal");
  for (const [name, dir] of [
    ["reader", workbenchDir],
    ["personal", userDir],
  ]) {
    for (const hidden of [".git", ".vera", "node_modules"]) {
      await mkdir(join(dir ?? "", hidden));
      await writeFile(join(dir ?? "", hidden, "private.txt"), "PRIVATE");
      await expect(
        f.catalog.load(name ?? "", `${hidden}/private.txt`, new AbortController().signal),
      ).rejects.toThrow();
    }
  }
  await mkdir(join(workbenchDir, "private"));
  await writeFile(join(workbenchDir, "private", "secret.txt"), "PRIVATE");
  await writeFile(join(workbenchDir, "private", "allowed.txt"), "ALLOWED");
  await writeFile(
    join(f.workbench, ".vera/.veraignore"),
    "skills/reader/private/**\n!skills/reader/private/allowed.txt\n",
  );
  await expect(
    f.catalog.load("reader", "private/secret.txt", new AbortController().signal),
  ).rejects.toThrow();
  expect(await f.catalog.load("reader", "private/allowed.txt", new AbortController().signal)).toMatchObject({
    text: "ALLOWED",
  });
  await writeFile(join(f.workbench, ".vera/.veraignore"), "skills/reader/**\n");
  expect((await f.catalog.metadata()).filter((s) => s.name !== "create-plugin").map((s) => s.name)).toEqual([
    "personal",
  ]);
  await expect(f.catalog.load("reader", undefined, new AbortController().signal)).rejects.toThrow();
  expect(
    (await f.catalog.list()).filter((s) => s.source !== "official").find((s) => s.name === "reader")?.error,
  ).toBe("unavailable");
});
it("rejects catalog overflow explicitly and rechecks disabled state after late async refresh", async () => {
  const f = await fixture();
  await f.skill("workbench", "reader");
  let refreshes = 0;
  const late = new SkillCatalog({
    root: f.workbench,
    disabled: () => f.disabled,
    refresh: async () => {
      if (++refreshes === 2) f.disabled.push("reader");
    },
  });
  await expect(late.load("reader", undefined, new AbortController().signal)).rejects.toThrow();
  await Promise.all(
    Array.from({ length: 1024 }, (_, i) => mkdir(join(f.workbench, ".vera/skills", `folder-${i}`))),
  );
  await expect(f.catalog.list()).rejects.toMatchObject({ code: "INVALID" });
});
it("validates exact metadata boundaries, YAML failures and unrestricted Markdown line count", () => {
  const format = (name: string, description: string, body = "") =>
    `---\nname: ${name}\ndescription: '${description}'\n---\n${body}`;
  expect(parseSkill(format("a".repeat(64), "d".repeat(1024)), "a".repeat(64)).description).toHaveLength(1024);
  expect(parseSkill(format("a", "d", "line\n".repeat(3000)), "a").body).toContain("line");
  for (const [content, folder] of [
    [format("a".repeat(65), "d"), "a".repeat(65)],
    [format("A", "d"), "A"],
    [format("a", "d".repeat(1025)), "a"],
    [format("a", " "), "a"],
    [format("a", "d"), "b"],
    ["---\nname: a\nname: b\n---", "a"],
    ["---\nname: a\ndescription: &x [*x]\n---\n", "a"],
  ])
    expect(() => parseSkill(content ?? "", folder ?? "")).toThrow();
});
it("bounds UTF8 reads and rejects binary, hardlinks, abort and obsolete ownership", async () => {
  const f = await fixture(),
    dir = await f.skill("workbench", "reader");
  await writeFile(join(dir, "large.txt"), Buffer.alloc(256 * 1024 + 1, 65));
  await writeFile(join(dir, "binary.txt"), Buffer.from([0, 1, 2]));
  await writeFile(join(dir, "invalid.txt"), Buffer.from([0xc3, 0x28]));
  await link(join(dir, "SKILL.md"), join(dir, "linked.md"));
  expect((await f.catalog.list()).filter((s) => s.source !== "official")[0]?.error).toBe("unavailable");
  await rm(join(dir, "linked.md"));
  for (const file of ["large.txt", "binary.txt", "invalid.txt"])
    await expect(f.catalog.load("reader", file, new AbortController().signal)).rejects.toThrow();
  const abort = new AbortController();
  abort.abort();
  await expect(f.catalog.load("reader", undefined, abort.signal)).rejects.toThrow();
  let checks = 0;
  const obsolete = new SkillCatalog({
    root: f.workbench,
    disabled: () => [],
    assertCurrent: () => {
      if (++checks > 3) throw Error("obsolete");
    },
  });
  await expect(obsolete.load("reader", undefined, new AbortController().signal)).rejects.toThrow("obsolete");
});
it.runIf(process.platform !== "win32")("rejects extra-file and directory symlink redirection", async () => {
  const f = await fixture(),
    dir = await f.skill("workbench", "reader");
  const external = join(f.userData, "secret");
  await writeFile(external, "SECRET");
  await symlink(external, join(dir, "extra.txt"));
  await expect(f.catalog.load("reader", "extra.txt", new AbortController().signal)).rejects.toThrow();
  await symlink(dir, join(f.workbench, ".vera/skills", "redirect"));
  expect(
    (await f.catalog.list()).filter((s) => s.source !== "official").find((s) => s.name === "redirect")?.error,
  ).toBe("unavailable");
});
it.runIf(process.platform === "win32")("rejects Windows junctions at skill roots", async () => {
  const f = await fixture(),
    dir = await f.skill("workbench", "reader");
  await symlink(dir, join(f.workbench, ".vera/skills", "redirect"), "junction");
  expect(
    (await f.catalog.list()).filter((s) => s.source !== "official").find((s) => s.name === "redirect")?.error,
  ).toBe("unavailable");
});
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "vera-skills-"));
  roots.push(root);
  const workbench = join(root, "bench"),
    userData = join(root, "data");
  await mkdir(join(workbench, ".vera"), { recursive: true });
  await mkdir(userData);
  const disabled: string[] = [];
  const catalog = new SkillCatalog({ root: workbench, userData, disabled: () => disabled });
  async function skill(
    source: "workbench" | "user",
    name: string,
    description = "Use for board work.",
    body = "BODY ONLY",
  ) {
    const dir = join(source === "user" ? userData : join(workbench, ".vera"), "skills", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`);
    return dir;
  }
  return { catalog, skill, disabled, workbench, userData };
}
it("discovers metadata only, resolves workbench clash, validates and disables", async () => {
  const f = await fixture();
  await f.skill("user", "board-reader", "User description");
  await f.skill("workbench", "board-reader", "Bench description");
  await f.skill("user", "other");
  await f.skill("workbench", "INVALID");
  const list = (await f.catalog.list()).filter((s) => s.source !== "official");
  expect(list.map((s) => s.name)).toEqual(["INVALID", "board-reader", "other"]);
  expect(list.find((s) => s.name === "INVALID")?.error).toBeTruthy();
  expect(list.find((s) => s.name === "board-reader")).toMatchObject({
    source: "workbench",
    description: "Bench description",
  });
  expect(JSON.stringify(list)).not.toContain("BODY ONLY");
  f.disabled.push("board-reader");
  expect((await f.catalog.metadata()).filter((s) => s.name !== "create-plugin").map((s) => s.name)).toEqual([
    "other",
  ]);
  await expect(f.catalog.load("board-reader", undefined, new AbortController().signal)).rejects.toThrow();
});
it("loads body and extra files, rejects escapes, and refreshes invalid shadowing", async () => {
  const f = await fixture();
  const dir = await f.skill("workbench", "reader");
  await f.skill("user", "reader");
  await writeFile(join(dir, "extra.md"), "EXTRA");
  expect(await f.catalog.load("reader", undefined, new AbortController().signal)).toMatchObject({
    text: "BODY ONLY\n",
  });
  expect(await f.catalog.load("reader", "extra.md", new AbortController().signal)).toMatchObject({
    text: "EXTRA",
  });
  for (const file of [
    "../reader/SKILL.md",
    "../../.vera/workbench.yaml",
    "C:/secret",
    "/secret",
    "nul",
    "extra.md:stream",
  ])
    await expect(f.catalog.load("reader", file, new AbortController().signal)).rejects.toThrow();
  await writeFile(join(dir, "SKILL.md"), "broken");
  expect((await f.catalog.metadata()).filter((s) => s.name !== "create-plugin")).toEqual([]);
  await expect(f.catalog.load("reader", "extra.md", new AbortController().signal)).rejects.toThrow();
});
it("trusts a user data root redirected above it but still refuses links inside the skills tree", async () => {
  const f = await fixture();
  await f.skill("user", "flash-esp32", "Flash ESP32 boards");
  // A junctioned parent stands in for OS folder redirection or MSIX file virtualization.
  const alias = join(f.workbench, "..", "alias");
  try {
    await symlink(join(f.userData, ".."), alias, process.platform === "win32" ? "junction" : "dir");
  } catch {
    return;
  }
  const redirected = new SkillCatalog({
    root: f.workbench,
    userData: join(alias, "data"),
    disabled: () => [],
  });
  expect(
    (await redirected.list()).filter((s) => s.source !== "official").map((s) => [s.name, s.error]),
  ).toEqual([["flash-esp32", undefined]]);
  const outside = await mkdtemp(join(tmpdir(), "vera-skills-outside-"));
  roots.push(outside);
  await mkdir(join(outside, "linked"));
  await writeFile(join(outside, "linked", "SKILL.md"), "---\nname: linked\ndescription: Outside\n---\n");
  await symlink(
    join(outside, "linked"),
    join(f.userData, "skills", "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(
    (await redirected.list()).filter((s) => s.source !== "official").find((s) => s.name === "linked")?.error,
  ).toBe("unavailable");
});
async function pluginSkill(base: string, id: string, name: string, body: string) {
  const folder = join(base, "plugins", id);
  await mkdir(join(folder, "skills", name), { recursive: true });
  await writeFile(
    join(folder, "skills", name, "SKILL.md"),
    `---\nname: ${name}\ndescription: Plugin ${id} skill.\n---\n${body}\n`,
  );
  return folder;
}
it("lists and loads skills of enabled plugins as source plugin (REQ-FUNC-6d88d2ec)", async () => {
  const f = await fixture();
  const enabled: { id: string; folder: string }[] = [];
  const catalog = new SkillCatalog({
    root: f.workbench,
    userData: f.userData,
    disabled: () => f.disabled,
    plugins: async () => enabled,
  });
  const folder = await pluginSkill(f.userData, "echo-tools", "echo-guide", "PLUGIN BODY");
  await writeFile(join(folder, "skills/echo-guide/ports.md"), "PORTS");
  expect((await catalog.list()).filter((s) => s.source !== "official")).toEqual([]);
  enabled.push({ id: "echo-tools", folder });
  expect((await catalog.list()).filter((s) => s.source !== "official")).toEqual([
    {
      name: "echo-guide",
      source: "plugin",
      plugin: "echo-tools",
      description: "Plugin echo-tools skill.",
      enabled: true,
    },
  ]);
  const signal = new AbortController().signal;
  expect(await catalog.load("echo-guide", undefined, signal)).toMatchObject({ text: "PLUGIN BODY\n" });
  expect(await catalog.load("echo-guide", "ports.md", signal)).toMatchObject({ text: "PORTS" });
  await expect(catalog.load("echo-guide", "../../plugin.yaml", signal)).rejects.toThrow();
  enabled.length = 0;
  expect((await catalog.list()).filter((s) => s.source !== "official")).toEqual([]);
  await expect(catalog.load("echo-guide", undefined, signal)).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("shadows plugin skills by workbench and user skills; the lower plugin id wins (REQ-FUNC-a5eff6c9)", async () => {
  const f = await fixture();
  const enabled = [
    { id: "b-tools", folder: await pluginSkill(f.userData, "b-tools", "shared", "B BODY") },
    { id: "a-tools", folder: await pluginSkill(f.userData, "a-tools", "shared", "A BODY") },
  ];
  const catalog = new SkillCatalog({
    root: f.workbench,
    userData: f.userData,
    disabled: () => [],
    plugins: async () => enabled,
  });
  const signal = new AbortController().signal;
  expect((await catalog.list()).filter((s) => s.source !== "official")).toMatchObject([
    { name: "shared", source: "plugin", plugin: "a-tools" },
  ]);
  expect(await catalog.load("shared", undefined, signal)).toMatchObject({ text: "A BODY\n" });
  await f.skill("user", "shared", "User copy", "USER BODY");
  expect((await catalog.list()).filter((s) => s.source !== "official")).toEqual([
    { name: "shared", source: "user", description: "User copy", enabled: true },
  ]);
  expect(await catalog.load("shared", undefined, signal)).toMatchObject({ text: "USER BODY\n" });
  await f.skill("workbench", "shared", "Bench copy", "BENCH BODY");
  expect((await catalog.list()).filter((s) => s.source !== "official")).toMatchObject([
    { name: "shared", source: "workbench" },
  ]);
  expect(await catalog.load("shared", undefined, signal)).toMatchObject({ text: "BENCH BODY\n" });
});
