/**
 * Model Mayhem YAML 内容包加载与引用校验。
 *
 * 作者：JucieOvo
 *
 * 加载器读取单卡单文件 YAML，并使用 Zod 验证结构、标识唯一性、牌组统计、
 * 行动组、研究前置和技术检定引用。任何错误都会直接抛出，不返回降级内容。
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { ZodType } from "zod";
import type {
  ActionCard,
  AssetCard,
  BalanceConfig,
  Card,
  ContentPackManifest,
  ContentSourceManifest,
  DeckConfig,
  Doctrine,
  Effect,
  Era,
  OrganizationCard,
  ResearchNode,
  TechCheckQuestion,
  WorldEventCard,
} from "./schema";
import {
  BalanceConfigSchema,
  CardPresentationSchema,
  CardSchema,
  ContentPackManifestSchema,
  ContentSourceManifestSchema,
  DeckConfigSchema,
  DoctrineSchema,
  EraSchema,
  ResearchNodeSchema,
  TechCheckQuestionSchema,
} from "./schema";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

/** 仓库内默认内容目录。部署时可通过 createContentLoader 覆盖。 */
export const DEFAULT_CONTENT_ROOT = join(moduleDirectory, "..", "..", "..", "content");

/** 已校验并建立索引的完整内容包。 */
export interface ContentPack {
  readonly manifest: ContentPackManifest;
  readonly balance: BalanceConfig;
  readonly cards: ReadonlyMap<string, Card>;
  readonly organizations: ReadonlyMap<string, OrganizationCard>;
  readonly assets: ReadonlyMap<string, AssetCard>;
  readonly actions: ReadonlyMap<string, ActionCard>;
  readonly worldEvents: ReadonlyMap<string, WorldEventCard>;
  readonly eras: ReadonlyMap<string, Era>;
  readonly decks: ReadonlyMap<string, DeckConfig>;
  readonly doctrines: ReadonlyMap<string, Doctrine>;
  readonly researchNodes: ReadonlyMap<string, ResearchNode>;
  readonly questions: ReadonlyMap<string, TechCheckQuestion>;
}

function readYamlFiles(root: string): readonly unknown[] {
  const entries = readdirSync(root, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const documents: unknown[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      documents.push(...readYamlFiles(path));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".yaml")) {
      continue;
    }
    documents.push(parse(readFileSync(path, "utf8")));
  }
  return documents;
}

function parseDocuments<T>(root: string, parser: ZodType<T>): readonly T[] {
  return readYamlFiles(root).map((document, index) => {
    const result = parser.safeParse(document);
    if (!result.success) {
      throw new Error(
        `内容文档解析失败：${root}，序号 ${index + 1}\n${JSON.stringify(result.error.issues, null, 2)}`,
      );
    }
    return result.data;
  });
}

const presentationFields = ["name", "description", "flavor", "banter", "thumbnail"] as const;

function loadCards(rootDirectory: string): ReadonlyMap<string, Card> {
  const presentations = indexUnique(
    parseDocuments(join(rootDirectory, "presentation", "cards"), CardPresentationSchema),
    "卡牌展示",
  );
  const cards = indexUnique(
    readYamlFiles(join(rootDirectory, "cards")).map((document, index) => {
      if (typeof document !== "object" || document === null || !("id" in document)) {
        throw new Error(`卡牌定义缺少 id：序号 ${index + 1}`);
      }
      const id = (document as { readonly id?: unknown }).id;
      if (typeof id !== "string" || id.length === 0) {
        throw new Error(`卡牌定义缺少有效 id：序号 ${index + 1}`);
      }
      const presentation = presentations.get(id);
      if (!presentation) {
        throw new Error(`卡牌 ${id} 缺少展示文件`);
      }
      for (const field of presentationFields) {
        if (field in document) {
          throw new Error(`卡牌 ${id} 的展示字段 ${field} 只能定义在展示文件中`);
        }
      }
      const result = CardSchema.safeParse({
        ...document,
        name: presentation.name,
        ...(presentation.description === undefined
          ? {}
          : { description: presentation.description }),
        flavor: presentation.flavor,
        banter: presentation.banter,
        ...(presentation.thumbnail ? { thumbnail: presentation.thumbnail } : {}),
      });
      if (!result.success) {
        throw new Error(
          `卡牌 ${id} 合并展示内容后解析失败：\n${JSON.stringify(result.error.issues, null, 2)}`,
        );
      }
      return result.data;
    }),
    "卡牌",
  );
  const extraPresentationIds = [...presentations.keys()].filter((id) => !cards.has(id));
  if (extraPresentationIds.length > 0) {
    throw new Error(`展示文件引用了不存在的卡牌：${extraPresentationIds.join("、")}`);
  }
  return cards;
}

function indexUnique<T extends { id: string }>(
  values: readonly T[],
  label: string,
): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (result.has(value.id)) {
      throw new Error(`${label}存在重复标识：${value.id}`);
    }
    result.set(value.id, value);
  }
  return result;
}

function requireReference(
  references: ReadonlyMap<string, unknown>,
  id: string,
  owner: string,
  label: string,
): void {
  if (!references.has(id)) {
    throw new Error(`${owner} 引用了不存在的${label}：${id}`);
  }
}

function countCopies(cardIds: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const cardId of cardIds) {
    counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
  }
  return counts;
}

export interface DeckCompositionIssue {
  readonly code: string;
  readonly message: string;
  readonly cardId?: string;
}

/**
 * 校验牌组的阵营和基础构成。
 *
 * 该函数是内容加载、服务端牌组保存和 Agent 牌组生成共同使用的构筑边界。
 * 阵营公司不能跨财团进入蓝图；开放权重等跨阵营资产仍按规则允许。
 */
export function validateDeckComposition(
  cards: ReadonlyMap<string, Card>,
  doctrines: ReadonlyMap<string, Doctrine>,
  balance: BalanceConfig,
  deck: DeckConfig,
): readonly DeckCompositionIssue[] {
  const issues: DeckCompositionIssue[] = [];
  if (!doctrines.has(deck.doctrineId)) {
    issues.push({
      code: "DOCTRINE_NOT_FOUND",
      message: `牌组方针不存在：${deck.doctrineId}`,
    });
  }
  if (deck.blueprintCardIds.length !== balance.blueprintsPerDeck) {
    issues.push({
      code: "INVALID_BLUEPRINT_COUNT",
      message: `牌组 ${deck.id} 的蓝图数量不是 ${balance.blueprintsPerDeck}`,
    });
  }
  if (deck.signatureActionIds.length !== balance.signatureSlots) {
    issues.push({
      code: "INVALID_SIGNATURE_COUNT",
      message: `牌组 ${deck.id} 的招牌行动数量不是 ${balance.signatureSlots}`,
    });
  }

  const copies = countCopies(deck.blueprintCardIds);
  let modelCount = 0;
  let technologyCount = 0;
  let ownFactionCompanyCount = 0;
  for (const [cardId, count] of copies) {
    const card = cards.get(cardId);
    if (!card) {
      issues.push({
        code: "CARD_NOT_FOUND",
        message: `牌组 ${deck.id} 引用了不存在的卡牌：${cardId}`,
        cardId,
      });
      continue;
    }
    if (count > balance.maxCopiesPerCard) {
      issues.push({
        code: "COPY_LIMIT",
        message: `牌组 ${deck.id} 中卡牌 ${cardId} 超过 ${balance.maxCopiesPerCard} 张`,
        cardId,
      });
    }
    if (card.type === "action" || card.type === "world_event") {
      issues.push({
        code: "INVALID_BLUEPRINT_CARD",
        message: `牌组 ${deck.id} 不应把 ${card.type} 放入蓝图牌堆`,
        cardId,
      });
      continue;
    }
    if (card.subtype === "model") {
      modelCount += count;
    } else if (card.type === "asset") {
      technologyCount += count;
    }
    if (card.type === "organization" && card.subtype === "company") {
      if (card.faction !== deck.faction) {
        issues.push({
          code: "OPPOSING_COMPANY",
          message: `牌组 ${deck.id} 不能加入对方财团公司：${cardId}`,
          cardId,
        });
      } else {
        ownFactionCompanyCount += count;
      }
    }
    if (
      card.type === "asset" &&
      card.subtype === "model" &&
      card.openness === "closed" &&
      card.faction !== "global" &&
      card.faction !== deck.faction
    ) {
      issues.push({
        code: "OPPOSING_CLOSED_MODEL",
        message: `牌组 ${deck.id} 不能加入对方财团闭源模型：${cardId}`,
        cardId,
      });
    }
  }
  if (ownFactionCompanyCount === 0) {
    issues.push({
      code: "FACTION_COMPANY_REQUIRED",
      message: `牌组 ${deck.id} 至少需要一张${deck.faction === "china" ? "中国" : "西方"}财团公司卡`,
    });
  }
  if (modelCount < balance.minimumModelsPerDeck) {
    issues.push({
      code: "MODEL_MINIMUM",
      message: `牌组 ${deck.id} 至少需要 ${balance.minimumModelsPerDeck} 张模型，当前为 ${modelCount}`,
    });
  }
  if (technologyCount < balance.minimumTechnologiesPerDeck) {
    issues.push({
      code: "TECHNOLOGY_MINIMUM",
      message: `牌组 ${deck.id} 至少需要 ${balance.minimumTechnologiesPerDeck} 张技术或论文，当前为 ${technologyCount}`,
    });
  }
  for (const actionId of deck.signatureActionIds) {
    const action = cards.get(actionId);
    if (action?.type !== "action" || !action.signature) {
      issues.push({
        code: "INVALID_SIGNATURE",
        message: `牌组 ${deck.id} 的招牌行动无效：${actionId}`,
        cardId: actionId,
      });
    }
  }
  return issues;
}

function validateDecks(
  decks: ReadonlyMap<string, DeckConfig>,
  cards: ReadonlyMap<string, Card>,
  doctrines: ReadonlyMap<string, Doctrine>,
  balance: BalanceConfig,
): void {
  for (const deck of decks.values()) {
    const issues = validateDeckComposition(cards, doctrines, balance, deck);
    const firstIssue = issues[0];
    if (firstIssue) {
      throw new Error(firstIssue.message);
    }
  }
}

function validateOrganizations(
  organizations: ReadonlyMap<string, OrganizationCard>,
  actions: ReadonlyMap<string, ActionCard>,
): void {
  for (const organization of organizations.values()) {
    for (const actionId of organization.actionSet) {
      const action = actions.get(actionId);
      if (!action) {
        throw new Error(`组织 ${organization.id} 引用了不存在的行动：${actionId}`);
      }
      if (action.signature) {
        throw new Error(`组织 ${organization.id} 的固定行动不能是招牌行动：${actionId}`);
      }
    }
  }
}

function validateAssets(assets: ReadonlyMap<string, AssetCard>, balance: BalanceConfig): void {
  for (const asset of assets.values()) {
    if (asset.assetKind !== "model") {
      continue;
    }
    for (const [ability, value] of Object.entries(asset.abilities)) {
      if (value < balance.modelScore.baseMinimum || value > balance.modelScore.baseMaximum) {
        throw new Error(
          `模型 ${asset.id} 的 ${ability} 基础能力超出 ${balance.modelScore.baseMinimum} 至 ${balance.modelScore.baseMaximum}`,
        );
      }
    }
  }
}

function modelDesignPoints(card: Extract<AssetCard, { assetKind: "model" }>): number {
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

function validateModelBudgets(assets: ReadonlyMap<string, AssetCard>): void {
  for (const asset of assets.values()) {
    if (asset.assetKind !== "model") {
      continue;
    }
    const designPoints = modelDesignPoints(asset);
    const budget = 2.5 * asset.cost.compute + 2 * asset.cost.capital;
    const deviation = (designPoints - budget) / budget;
    if (deviation < -0.15 || deviation > 0.2) {
      throw new Error(
        `模型 ${asset.id} 超出标准预算：设计点 ${designPoints}，预算 ${budget}，偏差 ${deviation.toFixed(3)}`,
      );
    }
  }
}

function effectsForCard(card: Card): readonly Effect[] {
  if (card.type === "organization") {
    return [
      ...card.passiveEffects,
      ...card.triggeredEffects.flatMap((triggered) => triggered.effects),
    ];
  }
  if (card.type === "asset") {
    return [...card.deployEffects, ...card.passiveEffects];
  }
  if (card.type === "action") {
    return [
      ...card.effects,
      ...(card.techCheck ? [...card.techCheck.baseEffects, ...card.techCheck.enhancedEffects] : []),
    ];
  }
  return card.effects;
}

function validateEffectAttacks(cards: ReadonlyMap<string, Card>): void {
  const allowedStatuses = new Set(["controversy", "outage", "overload", "regulation", "pressure"]);
  for (const card of cards.values()) {
    for (const effect of effectsForCard(card)) {
      if (effect.kind !== "effect_attack") {
        continue;
      }
      if (
        (effect.attackType === "compute_pressure" ||
          effect.attackType === "capital_pressure" ||
          effect.attackType === "cost_pressure" ||
          effect.attackType === "influence_pressure") &&
        effect.target !== "opponent"
      ) {
        throw new Error(`卡牌 ${card.id} 的玩家级特效攻击目标必须是 opponent`);
      }
      if (effect.attackType === "score_pressure" && effect.target !== "opponent_active_model") {
        throw new Error(`卡牌 ${card.id} 的评分压制必须指向 opponent_active_model`);
      }
      if (
        effect.attackType === "status_pressure" &&
        effect.target !== "opponent_active_model" &&
        effect.target !== "opponent_active_anchor"
      ) {
        throw new Error(
          `卡牌 ${card.id} 的状态攻击必须指向 opponent_active_model 或 opponent_active_anchor`,
        );
      }
      if (effect.attackType === "influence_pressure" && effect.amount !== 1) {
        throw new Error(`卡牌 ${card.id} 的影响力夺取强度只能是 1`);
      }
      if (effect.attackType === "status_pressure") {
        if (effect.status === undefined || !allowedStatuses.has(effect.status)) {
          throw new Error(`卡牌 ${card.id} 的状态攻击缺少合法负面状态`);
        }
        if (effect.amount !== 1) {
          throw new Error(`卡牌 ${card.id} 的状态攻击强度只能是 1`);
        }
      }
      if (effect.attackType === "cost_pressure" && effect.selector === undefined) {
        throw new Error(`卡牌 ${card.id} 的费用污染必须提供结构化选择器`);
      }
      if (effect.attackType === "score_pressure" && effect.amount > 2) {
        throw new Error(`卡牌 ${card.id} 的评分压制强度不能超过 2`);
      }
    }
  }
}

function validateResearch(
  nodes: ReadonlyMap<string, ResearchNode>,
  cards: ReadonlyMap<string, Card>,
  doctrines: ReadonlyMap<string, Doctrine>,
): void {
  for (const node of nodes.values()) {
    const prerequisiteIds =
      node.prerequisiteIds ?? (node.prerequisiteId ? [node.prerequisiteId] : []);
    if (node.depth === 1 && prerequisiteIds.length > 0) {
      throw new Error(`研究节点 ${node.id} 是首个节点，不能配置前置节点`);
    }
    if (node.depth > 1 && prerequisiteIds.length === 0) {
      throw new Error(`研究节点 ${node.id} 缺少前置节点`);
    }
    if (node.prerequisiteId !== undefined && node.prerequisiteIds !== undefined) {
      throw new Error(`研究节点 ${node.id} 不能同时使用单个和多个前置字段`);
    }
    for (const prerequisiteId of prerequisiteIds) {
      const prerequisite = nodes.get(prerequisiteId);
      if (!prerequisite) {
        throw new Error(`研究节点 ${node.id} 引用了不存在的前置节点：${prerequisiteId}`);
      }
      if (prerequisite.branch !== node.branch || prerequisite.depth >= node.depth) {
        throw new Error(`研究节点 ${node.id} 的前置节点必须位于同分支的更早深度`);
      }
    }
    for (const cardId of node.rewardCardIds) {
      requireReference(cards, cardId, `研究节点 ${node.id}`, "奖励卡");
    }
    if (node.rewardDoctrineId !== undefined) {
      requireReference(doctrines, node.rewardDoctrineId, `研究节点 ${node.id}`, "奖励方针");
    }
  }
}

function validateQuestions(
  actions: ReadonlyMap<string, ActionCard>,
  questions: ReadonlyMap<string, TechCheckQuestion>,
): void {
  for (const action of actions.values()) {
    if (!action.techCheck) {
      continue;
    }
    const question = questions.get(action.techCheck.questionId);
    if (!question) {
      throw new Error(
        `行动 ${action.id} 引用了不存在的技术检定题目：${action.techCheck.questionId}`,
      );
    }
    const optionIds = new Set(question.options.map((option) => option.id));
    if (!optionIds.has(question.correctOptionId)) {
      throw new Error(`技术检定题目 ${question.id} 的正确答案不在选项中`);
    }
  }
}

function validateEras(eras: ReadonlyMap<string, Era>): void {
  const initialEras = [...eras.values()].filter((era) => era.initial);
  if (initialEras.length !== 1) {
    throw new Error(`时代必须恰好有一个初始时代，当前为 ${initialEras.length}`);
  }
  const ordered = [...eras.values()].sort((left, right) => left.order - right.order);
  for (let index = 0; index < ordered.length; index += 1) {
    const era = ordered[index];
    if (!era || era.order !== index) {
      throw new Error("时代顺序必须从 0 开始连续");
    }
    const next = ordered[index + 1];
    if (next) {
      if (era.nextEraId !== next.id) {
        throw new Error(`时代 ${era.id} 的下一时代必须是 ${next.id}`);
      }
    } else if (era.nextEraId !== undefined) {
      throw new Error(`最后一个时代 ${era.id} 不能配置下一时代`);
    }
  }
}

/** 从真实文件系统加载和校验内容包。 */
export function loadContentPack(rootDirectory: string = DEFAULT_CONTENT_ROOT): ContentPack {
  const sourceManifestDocument = readYamlFiles(join(rootDirectory, "manifest"));
  if (sourceManifestDocument.length !== 1) {
    throw new Error(`内容源清单必须恰好一份，当前为 ${sourceManifestDocument.length}`);
  }
  const sourceManifestResult = ContentSourceManifestSchema.safeParse(sourceManifestDocument[0]);
  if (!sourceManifestResult.success) {
    throw new Error(
      `内容源清单解析失败：${JSON.stringify(sourceManifestResult.error.issues, null, 2)}`,
    );
  }
  const sourceManifest: ContentSourceManifest = sourceManifestResult.data;
  const balanceDocument = readYamlFiles(join(rootDirectory, "balance"));
  if (balanceDocument.length !== 1) {
    throw new Error(`平衡配置必须恰好一份，当前为 ${balanceDocument.length}`);
  }
  const balanceResult = BalanceConfigSchema.safeParse(balanceDocument[0]);
  if (!balanceResult.success) {
    throw new Error(`平衡配置解析失败：${JSON.stringify(balanceResult.error.issues, null, 2)}`);
  }
  const balance = balanceResult.data;
  if (
    sourceManifest.rulesetVersion !== balance.version ||
    sourceManifest.balanceId !== balance.id
  ) {
    throw new Error("内容源清单与平衡配置版本不一致");
  }

  const cards = loadCards(rootDirectory);
  const organizations = indexUnique(
    [...cards.values()].filter((card): card is OrganizationCard => card.type === "organization"),
    "组织卡",
  );
  const assets = indexUnique(
    [...cards.values()].filter((card): card is AssetCard => card.type === "asset"),
    "资产卡",
  );
  const actions = indexUnique(
    [...cards.values()].filter((card): card is ActionCard => card.type === "action"),
    "行动卡",
  );
  const worldEvents = indexUnique(
    [...cards.values()].filter((card): card is WorldEventCard => card.type === "world_event"),
    "世界事件卡",
  );
  const eras = indexUnique(parseDocuments(join(rootDirectory, "eras"), EraSchema), "时代");
  const decks = indexUnique(parseDocuments(join(rootDirectory, "decks"), DeckConfigSchema), "牌组");
  const doctrines = indexUnique(
    parseDocuments(join(rootDirectory, "doctrines"), DoctrineSchema),
    "方针",
  );
  const researchNodes = indexUnique(
    parseDocuments(join(rootDirectory, "research"), ResearchNodeSchema),
    "研究节点",
  );
  const questions = indexUnique(
    parseDocuments(join(rootDirectory, "questions"), TechCheckQuestionSchema),
    "技术检定题目",
  );

  if (cards.size !== balance.uniqueCardTarget) {
    throw new Error(`参考内容集预期 ${balance.uniqueCardTarget} 张唯一卡，当前为 ${cards.size}`);
  }
  validateDecks(decks, cards, doctrines, balance);
  validateOrganizations(organizations, actions);
  validateAssets(assets, balance);
  validateModelBudgets(assets);
  validateEffectAttacks(cards);
  validateEras(eras);
  validateResearch(researchNodes, cards, doctrines);
  validateQuestions(actions, questions);

  const manifestResult = ContentPackManifestSchema.safeParse({
    id: sourceManifest.id,
    version: sourceManifest.version,
    rulesetVersion: sourceManifest.rulesetVersion,
    balanceId: sourceManifest.balanceId,
    cardIds: [...cards.keys()].sort(),
    eraIds: [...eras.keys()].sort(),
    researchNodeIds: [...researchNodes.keys()].sort(),
    deckIds: [...decks.keys()].sort(),
    questionIds: [...questions.keys()].sort(),
    doctrineIds: [...doctrines.keys()].sort(),
  });
  if (!manifestResult.success) {
    throw new Error(`内容清单构造失败：${JSON.stringify(manifestResult.error.issues, null, 2)}`);
  }

  return {
    manifest: manifestResult.data,
    balance,
    cards,
    organizations,
    assets,
    actions,
    worldEvents,
    eras,
    decks,
    doctrines,
    researchNodes,
    questions,
  };
}
