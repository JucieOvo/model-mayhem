/**
 * 官方 Agent Skills 加载入口。
 *
 * 作者：JucieOvo
 *
 * Skills 只提供操作指导，不拥有权限，也不替代工具网关。Pi 与其他 Agent 可以读取
 * 相同的版本化 Markdown 内容。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const OFFICIAL_SKILLS_ROOT = join(moduleDirectory, "..", "skills");

export const OFFICIAL_SKILL_NAMES = [
  "modelmayhem-play",
  "modelmayhem-deckbuilding",
  "modelmayhem-replay-review",
  "modelmayhem-content-author",
  "modelmayhem-agent-builder",
] as const;

export type OfficialSkillName = (typeof OFFICIAL_SKILL_NAMES)[number];

/** 读取一个官方 Skill 的完整 Markdown。 */
export function loadOfficialSkill(skillName: OfficialSkillName): string {
  return readFileSync(join(OFFICIAL_SKILLS_ROOT, skillName, "SKILL.md"), "utf8");
}

/** 读取官方 Skill 的稳定参考文档。 */
export function loadOfficialSkillReference(
  skillName: OfficialSkillName,
  referenceName: "combat-rules.md" | "battle-guide.md",
): string {
  return readFileSync(join(OFFICIAL_SKILLS_ROOT, skillName, "references", referenceName), "utf8");
}
