/**
 * 游戏系统结构审计。
 *
 * 作者：JucieOvo
 *
 * 该脚本按设计标准检查模型预算、研究奖励覆盖、基础行动数量和 Skills 输出契约。
 * 它不判断游戏是否有趣，只阻止已知的结构性回归。
 */

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDirectory, "..");
const contentRoot = join(projectRoot, "content");
const contentRequire = createRequire(
  join(projectRoot, "packages", "model-mayhem-content", "package.json"),
);
const { parse } = contentRequire("yaml");

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function readYaml(path) {
  return parse(readFileSync(path, "utf8"));
}

function modelDesignPoints(card) {
  const abilities = Object.values(card.abilities).sort((left, right) => right - left);
  const total = abilities.reduce((sum, value) => sum + value, 0);
  const focus = Math.max(0, (abilities[0] ?? 0) - 3) + Math.max(0, (abilities[1] ?? 0) - 4);
  const compatibilityAdjustment =
    card.compatibleOrganizationTags.length <= 1
      ? -1
      : card.compatibleOrganizationTags.length >= 3
        ? 1
        : 0;
  const closedPremium = card.openness === "closed" && total >= 12 ? 2 : 0;
  return total + focus + compatibilityAdjustment + closedPremium;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const allCards = walk(join(contentRoot, "cards"))
  .filter((path) => path.endsWith(".yaml"))
  .map(readYaml);
const models = allCards.filter((card) => card.subtype === "model");
const budgetViolations = [];
for (const model of models) {
  const designPoints = modelDesignPoints(model);
  const budget = 2.5 * model.cost.compute + 2 * model.cost.capital;
  const deviation = (designPoints - budget) / budget;
  if (deviation < -0.15 || deviation > 0.2) {
    budgetViolations.push({
      id: model.id,
      designPoints,
      budget,
      deviation,
    });
  }
}
assert(
  budgetViolations.length === 0,
  `模型预算越界：${budgetViolations.map((entry) => entry.id).join("、")}`,
);

const researchNodes = readdirSync(join(contentRoot, "research"))
  .filter((file) => file.endsWith(".yaml"))
  .map((file) => readYaml(join(contentRoot, "research", file)));
const rewardedCardIds = new Set(researchNodes.flatMap((node) => node.rewardCardIds));
const generatedCards = walk(join(contentRoot, "cards", "reality-v0.2"))
  .filter((path) => path.endsWith(".yaml"))
  .map(readYaml);
const uncoveredCards = generatedCards.filter((card) => !rewardedCardIds.has(card.id));
assert(
  uncoveredCards.length === 0,
  `生成卡缺少研究奖励：${uncoveredCards.map((card) => card.id).join("、")}`,
);
assert(researchNodes.length === 48, `研究节点应为 48 个，当前为 ${researchNodes.length}`);
const eras = readdirSync(join(contentRoot, "eras"))
  .filter((file) => file.endsWith(".yaml"))
  .map((file) => readYaml(join(contentRoot, "eras", file)))
  .sort((left, right) => left.order - right.order);
assert(eras.length === 8, `时代应为 8 个，当前为 ${eras.length}`);
for (const [index, era] of eras.entries()) {
  assert(era.order === index, `时代顺序不连续：${era.id}`);
  assert(
    era.order === eras.length - 1 ? era.nextEraId === undefined : era.nextEraId,
    `时代 ${era.id} 的后续时代配置无效`,
  );
}
for (const branch of ["architecture", "training", "systems", "product"]) {
  const nodes = researchNodes
    .filter((node) => node.branch === branch)
    .sort((left, right) => left.depth - right.depth);
  assert(nodes.length === 12, `${branch} 研究分支应为 12 个节点`);
  assert(
    nodes.every((node, index) => node.depth === index + 1),
    `${branch} 研究分支深度不连续`,
  );
  assert(
    nodes.every((node) => node.stageId && node.completionCategory),
    `${branch} 研究节点缺少阶段或完成度类别`,
  );
  assert(
    nodes.every((node) => eras.some((era) => era.id === node.stageId)),
    `${branch} 研究节点引用了不存在的时代`,
  );
  const convergence = nodes.find((node) => node.depth === 12);
  assert(
    convergence?.prerequisiteMode === "any" && convergence.prerequisiteIds?.length === 3,
    `${branch} 缺少三路线汇合节点`,
  );
}

const actions = readdirSync(join(contentRoot, "cards", "actions"))
  .filter((file) => file.endsWith(".yaml"))
  .map((file) => readYaml(join(contentRoot, "cards", "actions", file)));
const basicActions = actions.filter(
  (card) => !card.signature && card.tags.includes("basic_action"),
);
assert(basicActions.length === 12, `基础行动应为 12 张，当前为 ${basicActions.length}`);

const referenceDecks = readdirSync(join(contentRoot, "decks"))
  .filter((file) => file.endsWith(".yaml"))
  .map((file) => readYaml(join(contentRoot, "decks", file)));
for (const deck of referenceDecks) {
  assert(deck.faction === "china" || deck.faction === "west", `预组 ${deck.id} 缺少中国或西方财团`);
}

const skillsRoot = join(projectRoot, "packages", "skills", "skills");
const combatRulesPath = join(skillsRoot, "modelmayhem-play", "references", "combat-rules.md");
const battleGuidePath = join(skillsRoot, "modelmayhem-play", "references", "battle-guide.md");
const combatRules = readFileSync(combatRulesPath, "utf8");
const battleGuide = readFileSync(battleGuidePath, "utf8");
assert(combatRules.includes("财团身份在档案创建后确定"), "对战规则缺少财团身份约束");
assert(combatRules.includes("对方财团公司不能进入牌组"), "对战规则缺少牌组阵营边界");
assert(battleGuide.includes("每回合最小检查表"), "战斗说明缺少回合检查表");

const requiredSkillSections = {
  "modelmayhem-play": ["## 输出契约", "当前目标", "提交行动", "提交后核对", "失败处理"],
  default: ["## 输出契约", "设计假设", "预期行为", "验证指标", "反证条件", "停止条件"],
};
const skillDirectories = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
for (const skillName of skillDirectories) {
  const markdown = readFileSync(join(skillsRoot, skillName, "SKILL.md"), "utf8");
  const sections = requiredSkillSections[skillName] ?? requiredSkillSections.default;
  for (const section of sections) {
    assert(markdown.includes(section), `Skill ${skillName} 缺少输出契约字段：${section}`);
  }
}

console.log(
  `游戏系统审计通过：${models.length} 张模型预算合规，${researchNodes.length} 个研究节点覆盖 ${generatedCards.length} 张生成卡，${basicActions.length} 张基础行动，${referenceDecks.length} 套阵营预组，${skillDirectories.length} 个 Skills 契约完整。`,
);
