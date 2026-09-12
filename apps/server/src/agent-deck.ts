/**
 * Agent 对战牌组生成。
 *
 * 作者：JucieOvo
 *
 * Agent 不参与赛前牌组编辑，也不读取玩家当前出战牌组、收藏或研究进度。服务端
 * 使用对局种子从内容包的公开合法卡池随机分配一套符合构筑约束的牌组。
 */

import type { ConsortiumFaction } from "@modelmayhem/contracts";
import { GameRandom } from "@modelmayhem/game-kernel";
import type { ActionCard, ContentPack, DeckConfig } from "@modelmayhem/model-mayhem-content";
import { validateDeckComposition } from "@modelmayhem/model-mayhem-content";

interface AgentDeckPool {
  readonly organizations: readonly string[];
  readonly factionCompanies: readonly string[];
  readonly models: readonly string[];
  readonly technologies: readonly string[];
  readonly signatures: readonly string[];
  readonly doctrines: readonly string[];
}

function createPool(content: ContentPack, faction: ConsortiumFaction): AgentDeckPool {
  const organizations: string[] = [];
  const factionCompanies: string[] = [];
  const models: string[] = [];
  const technologies: string[] = [];
  for (const card of content.cards.values()) {
    if (card.type === "organization") {
      if (card.subtype !== "company" || card.faction === faction) {
        organizations.push(card.id);
      }
      if (card.subtype === "company" && card.faction === faction) {
        factionCompanies.push(card.id);
      }
      continue;
    }
    if (card.type !== "asset") {
      continue;
    }
    if (card.subtype === "model") {
      if (card.openness !== "closed" || card.faction === "global" || card.faction === faction) {
        models.push(card.id);
      }
    } else {
      technologies.push(card.id);
    }
  }
  return {
    organizations,
    factionCompanies,
    models,
    technologies,
    signatures: [...content.actions.values()]
      .filter((action) => action.signature)
      .map((action) => action.id),
    doctrines: [...content.doctrines.keys()],
  };
}

function takeRandomCopies(
  cardIds: readonly string[],
  count: number,
  maxCopies: number,
  random: GameRandom,
  initialCardIds: readonly string[] = [],
): string[] {
  const initialCounts = new Map<string, number>();
  for (const cardId of initialCardIds) {
    initialCounts.set(cardId, (initialCounts.get(cardId) ?? 0) + 1);
  }
  const expanded = cardIds.flatMap((cardId) =>
    Array.from({ length: Math.max(0, maxCopies - (initialCounts.get(cardId) ?? 0)) }, () => cardId),
  );
  if (expanded.length < count) {
    throw new Error(`Agent 随机牌组卡池不足：需要 ${count} 张，当前只能提供 ${expanded.length} 张`);
  }
  return random.shuffle(expanded).slice(0, count);
}

function randomTargets(
  content: ContentPack,
  pool: AgentDeckPool,
  random: GameRandom,
): {
  readonly organizations: number;
  readonly models: number;
  readonly technologies: number;
} {
  const balance = content.balance;
  const organizationCapacity = pool.organizations.length * balance.maxCopiesPerCard;
  const modelCapacity = pool.models.length * balance.maxCopiesPerCard;
  const technologyCapacity = pool.technologies.length * balance.maxCopiesPerCard;
  const minimumOrganizations = 1;
  if (organizationCapacity < minimumOrganizations) {
    throw new Error("内容包卡池没有足够的组织卡用于 Agent 随机牌组");
  }
  const maximumOrganizations = Math.min(
    balance.anchorSlots,
    organizationCapacity,
    balance.blueprintsPerDeck - balance.minimumModelsPerDeck - balance.minimumTechnologiesPerDeck,
  );
  if (maximumOrganizations < minimumOrganizations) {
    throw new Error("内容包卡池无法同时满足 Agent 随机牌组的组织、模型和技术数量约束");
  }

  const organizations = random.nextInt(minimumOrganizations, maximumOrganizations);
  const minimumModels = Math.max(
    balance.minimumModelsPerDeck,
    balance.blueprintsPerDeck - organizations - technologyCapacity,
  );
  const maximumModels = Math.min(
    modelCapacity,
    balance.blueprintsPerDeck - organizations - balance.minimumTechnologiesPerDeck,
  );
  if (maximumModels < minimumModels) {
    throw new Error("内容包卡池无法满足 Agent 随机牌组的模型数量约束");
  }

  const models = random.nextInt(minimumModels, maximumModels);
  const technologies = balance.blueprintsPerDeck - organizations - models;
  if (technologies < balance.minimumTechnologiesPerDeck || technologies > technologyCapacity) {
    throw new Error("Agent 随机牌组的技术数量计算越界");
  }
  return { organizations, models, technologies };
}

/**
 * 按公开规则和真实种子为 Agent 随机分配牌组。
 *
 * 规则只使用内容包公开卡池、平衡参数和种子，不读取玩家当前牌组、收藏、研究
 * 进度、隐藏手牌或抽牌顺序。牌堆顺序仍由规则引擎在对局初始化时洗牌。
 */
export function buildRandomAgentDeck(
  content: ContentPack,
  seed: number,
  faction: ConsortiumFaction,
): DeckConfig {
  const random = GameRandom.create(seed ^ 0x5f37_59df);
  const pool = createPool(content, faction);
  if (pool.doctrines.length === 0) {
    throw new Error("内容包没有可用于 Agent 随机牌组的方针");
  }
  const factionCompany = random.shuffle(pool.factionCompanies)[0];
  if (!factionCompany) {
    throw new Error(`内容包没有可用于 ${faction} 财团 Agent 牌组的公司`);
  }
  const targets = randomTargets(content, pool, random);
  if (targets.organizations < 1) {
    throw new Error("Agent 牌组必须包含至少一个阵营公司");
  }
  const blueprintCardIds = [
    factionCompany,
    ...takeRandomCopies(
      pool.organizations,
      targets.organizations - 1,
      content.balance.maxCopiesPerCard,
      random,
      [factionCompany],
    ),
    ...takeRandomCopies(pool.models, targets.models, content.balance.maxCopiesPerCard, random),
    ...takeRandomCopies(
      pool.technologies,
      targets.technologies,
      content.balance.maxCopiesPerCard,
      random,
    ),
  ];
  if (blueprintCardIds.length !== content.balance.blueprintsPerDeck) {
    throw new Error(`Agent 随机牌组蓝图数量不是 ${content.balance.blueprintsPerDeck}`);
  }

  const signatureActionIds = random
    .shuffle(pool.signatures)
    .slice(0, content.balance.signatureSlots);
  if (signatureActionIds.length !== content.balance.signatureSlots) {
    throw new Error("Agent 随机牌组缺少足够的招牌行动");
  }
  for (const actionId of signatureActionIds) {
    const action: ActionCard | undefined = content.actions.get(actionId);
    if (!action?.signature) {
      throw new Error(`Agent 随机牌组包含无效招牌行动：${actionId}`);
    }
  }

  const doctrineId = random.shuffle(pool.doctrines)[0];
  if (!doctrineId) {
    throw new Error("Agent 随机牌组缺少方针");
  }
  const deck: DeckConfig = {
    id: `agent-random-${faction}-${seed}`,
    name: `${faction === "china" ? "中国" : "西方"}财团 Agent 随机牌组`,
    faction,
    doctrineId,
    blueprintCardIds,
    signatureActionIds,
    description: "从内容包对立财团与跨阵营开放卡池按构筑规则和对局种子随机分配。",
  };
  const issues = validateDeckComposition(content.cards, content.doctrines, content.balance, deck);
  const firstIssue = issues[0];
  if (firstIssue) {
    throw new Error(`Agent 随机牌组不合法：${firstIssue.message}`);
  }
  return deck;
}
