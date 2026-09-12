/**
 * Pi Package 项目入口。
 *
 * 作者：JucieOvo
 *
 * 该包向 Pi 生态暴露官方对战工具工厂与 Skills 路径。官方参考服务内嵌 Agent 时
 * 直接使用 pi-agent-adapter，不需要加载 MCP。
 */

import { createPiBattleTools, PiBattleAgentRunner } from "@modelmayhem/pi-agent-adapter";
import { OFFICIAL_SKILL_NAMES, OFFICIAL_SKILLS_ROOT } from "@modelmayhem/skills";

export interface PiPackageManifest {
  readonly name: string;
  readonly version: string;
  readonly skillsDirectory: string;
  readonly skills: readonly string[];
  readonly tools: readonly string[];
}

/** 返回 Pi Package 的稳定元数据。 */
export function getPiPackageManifest(): PiPackageManifest {
  return {
    name: "@modelmayhem/pi-package",
    version: "0.1.0",
    skillsDirectory: OFFICIAL_SKILLS_ROOT,
    skills: OFFICIAL_SKILL_NAMES,
    tools: ["get_turn_context", "simulate_action", "perform_action"],
  };
}

export { createPiBattleTools, PiBattleAgentRunner };
