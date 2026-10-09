// Loads skills/<name>/SKILL.md (03 §3): frontmatter enters the system prompt, the body loads on `load_skill`.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Skill } from "@benchpilot/shared";
import { SKILL_BODY_MAX_LINES, skillFrontmatterSchema } from "@benchpilot/shared/content";
import { ContentError, splitFrontmatter, validate } from "../content.ts";

export function loadSkill(file: string): Skill {
  const { data, body } = splitFrontmatter(readFileSync(file, "utf8").replace(/\r\n/g, "\n"), file);
  const fm = validate(skillFrontmatterSchema, data, file);
  if (path.basename(path.dirname(file)) !== fm.name) throw new ContentError(file, `folder name must match name '${fm.name}'`);
  const trimmed = body.trim();
  const lines = trimmed.split("\n").length;
  if (!trimmed) throw new ContentError(file, "empty body");
  if (lines > SKILL_BODY_MAX_LINES) throw new ContentError(file, `body has ${lines} lines (max ${SKILL_BODY_MAX_LINES})`);
  return { name: fm.name, description: fm.description.trim(), body: trimmed + "\n" };
}

export function loadSkills(contentDir: string): Skill[] {
  const root = path.join(contentDir, "skills");
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(root, e.name, "SKILL.md")))
    .map((e) => loadSkill(path.join(root, e.name, "SKILL.md")))
    .sort((a, b) => a.name.localeCompare(b.name));
}
