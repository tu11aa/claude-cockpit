import type { WorkspaceDriver } from "../workspaces/types.js";
import type { ProjectionSource } from "../projection/types.js";

interface SkillFrontmatter {
  name: string;
  description: string;
}

function parseSkill(raw: string): { frontmatter: SkillFrontmatter; body: string } | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const [, fmBlock, body] = match;
  const fm: Partial<SkillFrontmatter> = {};
  for (const line of fmBlock.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) (fm as Record<string, string>)[kv[1]] = kv[2].trim();
  }
  if (!fm.name || !fm.description) return null;
  return { frontmatter: fm as SkillFrontmatter, body: body.trim() };
}

async function readSkills(
  driver: WorkspaceDriver,
  skillsDir: string,
): Promise<ProjectionSource["skills"]> {
  if (!(await driver.exists(skillsDir))) return [];
  const names = await driver.list(skillsDir);
  const skills: ProjectionSource["skills"] = [];
  for (const name of names) {
    const skillPath = `${skillsDir}/${name}/SKILL.md`;
    if (!(await driver.exists(skillPath))) continue;
    const raw = await driver.read(skillPath);
    const parsed = parseSkill(raw);
    if (!parsed) continue;
    skills.push({
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      content: parsed.body,
    });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

export async function readUserLevelSource(driver: WorkspaceDriver): Promise<ProjectionSource> {
  const skills = await readSkills(driver, "plugin/skills");
  return { instructions: "", skills };
}

export async function readProjectLevelSource(
  driver: WorkspaceDriver,
  projectRoot: string,
): Promise<ProjectionSource | null> {
  const agentsPath = `${projectRoot}/AGENTS.md`;
  if (!(await driver.exists(agentsPath))) return null;
  const instructions = await driver.read(agentsPath);
  const skills = await readSkills(driver, `${projectRoot}/plugin/skills`);
  return { instructions, skills };
}
