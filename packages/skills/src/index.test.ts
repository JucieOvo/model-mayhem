/**
 * 官方 Skills 结构测试。
 *
 * 作者：JucieOvo
 *
 * 测试保证所有官方 Skill 都声明完整输出契约，避免后续退化成只有流程文本的提示词。
 */

import { describe, expect, it } from "vitest";
import { loadOfficialSkill, loadOfficialSkillReference, OFFICIAL_SKILL_NAMES } from "./index";

const defaultRequiredSections = [
  "## 输出契约",
  "设计假设",
  "预期行为",
  "验证指标",
  "反证条件",
  "停止条件",
] as const;

const requiredSections: Record<string, readonly string[]> = {
  default: defaultRequiredSections,
  "modelmayhem-play": ["## 输出契约", "当前目标", "提交行动", "提交后核对", "失败处理"],
};

describe("官方 Skills", () => {
  it.each(OFFICIAL_SKILL_NAMES)("%s 包含完整输出契约", (skillName) => {
    const markdown = loadOfficialSkill(skillName);
    for (const section of requiredSections[skillName] ?? defaultRequiredSections) {
      expect(markdown).toContain(section);
    }
  });

  it("对战 Skill 提供完整规则文档和战斗说明", () => {
    const rules = loadOfficialSkillReference("modelmayhem-play", "combat-rules.md");
    const guide = loadOfficialSkillReference("modelmayhem-play", "battle-guide.md");
    expect(rules).toContain("# Model Mayhem 对战规则");
    expect(rules).toContain("财团身份在档案创建后确定");
    expect(guide).toContain("# Model Mayhem 战斗说明");
    expect(guide).toContain("每回合最小检查表");
  });
});
