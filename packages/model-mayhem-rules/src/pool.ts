/**
 * 双牌库生成与抽牌。
 *
 * 作者：JucieOvo
 *
 * 蓝图牌堆来自赛前锁定预组；行动池每轮由通用行动、场上组织行动组和招牌行动
 * 动态构成。该模块不修改内容定义，只维护真实随机顺序与手牌状态。
 */

import type { DomainEvent } from "@modelmayhem/game-kernel";
import type { ActionCard, Card, ContentPack } from "@modelmayhem/model-mayhem-content";
import { requireCard } from "./selectors";
import type {
  ActionInstance,
  BlueprintPityState,
  MatchState,
  ModelMayhemEventPayload,
  ModelMayhemEventType,
  PlayerState,
} from "./types";

type EmitEvent = (event: DomainEvent<ModelMayhemEventType, ModelMayhemEventPayload>) => void;

interface ActionPoolEntry {
  readonly cardId: string;
  readonly sourceAnchorId?: string;
}

export type BlueprintPityCategory = keyof BlueprintPityState;

const BLUEPRINT_PITY_CATEGORIES: readonly BlueprintPityCategory[] = [
  "organization",
  "model",
  "knowledge",
];

function isActionCard(value: unknown): value is ActionCard {
  return typeof value === "object" && value !== null && "type" in value && value.type === "action";
}

/** 生成当前座位上可进入行动牌堆的候选行动。 */
export function buildActionPool(
  content: ContentPack,
  state: MatchState,
  seatId: string,
): readonly ActionPoolEntry[] {
  const player = state.players[seatId];
  if (!player) {
    throw new Error(`行动池缺少玩家：${seatId}`);
  }
  const entries: ActionPoolEntry[] = [];
  const indexedCardIds = new Set<string>();

  for (const card of content.actions.values()) {
    if (!card.signature && card.tags.includes("basic_action")) {
      entries.push({ cardId: card.id });
      indexedCardIds.add(card.id);
    }
  }

  for (const anchor of Object.values(state.anchors)) {
    if (anchor.ownerSeatId !== seatId || anchor.isHomeLab) {
      continue;
    }
    const hasOutage = anchor.statuses.some((status) => status.id === "outage" && !status.pending);
    if (hasOutage || anchor.organizationCardId === null) {
      continue;
    }
    const organization = content.organizations.get(anchor.organizationCardId);
    if (!organization) {
      throw new Error(`组织据点缺少内容：${anchor.organizationCardId}`);
    }
    for (const actionId of organization.actionSet) {
      if (indexedCardIds.has(actionId)) {
        continue;
      }
      entries.push({ cardId: actionId, sourceAnchorId: anchor.id });
      indexedCardIds.add(actionId);
    }
  }

  for (const actionId of player.signatureActionIds) {
    if (indexedCardIds.has(actionId)) {
      continue;
    }
    entries.push({ cardId: actionId });
    indexedCardIds.add(actionId);
  }

  return entries;
}

/** 补充蓝图牌堆：空牌堆时把归档区用真实随机数洗回。 */
function refillBlueprintDeck(player: PlayerState, shuffle: <T>(values: readonly T[]) => T[]): void {
  if (player.blueprintDeck.length > 0 || player.blueprintArchive.length === 0) {
    return;
  }
  player.blueprintDeck = shuffle(player.blueprintArchive);
  player.blueprintArchive.length = 0;
}

function ensureBlueprintPity(player: PlayerState): BlueprintPityState {
  player.blueprintPity ??= {
    organization: 0,
    model: 0,
    knowledge: 0,
  };
  return player.blueprintPity;
}

function blueprintPityCategories(card: Card): readonly BlueprintPityCategory[] {
  const categories: BlueprintPityCategory[] = [];
  if (card.type === "organization") {
    categories.push("organization");
  }
  if (card.type === "asset" && card.assetKind === "model") {
    categories.push("model");
  }
  if (card.type === "asset" && (card.subtype === "technology" || card.subtype === "paper")) {
    categories.push("knowledge");
  }
  return categories;
}

function cardForBlueprintInstance(
  content: ContentPack,
  state: MatchState,
  instanceId: string,
): Card {
  const instance = state.cardInstances[instanceId];
  if (!instance) {
    throw new Error(`蓝图牌堆缺少卡牌实例：${instanceId}`);
  }
  const card = content.cards.get(instance.cardId);
  if (!card) {
    throw new Error(`蓝图牌堆缺少卡牌内容：${instance.cardId}`);
  }
  return card;
}

function findPityCardIndex(
  content: ContentPack,
  state: MatchState,
  player: PlayerState,
  category: BlueprintPityCategory,
): number {
  return player.blueprintDeck.findIndex((instanceId) =>
    blueprintPityCategories(cardForBlueprintInstance(content, state, instanceId)).includes(
      category,
    ),
  );
}

/** 根据当前起手牌设置初始保底计数。 */
export function initializeBlueprintPity(
  content: ContentPack,
  state: MatchState,
  player: PlayerState,
): void {
  const pity = ensureBlueprintPity(player);
  const categoriesInHand = new Set<BlueprintPityCategory>();
  for (const instanceId of player.blueprintHand) {
    for (const category of blueprintPityCategories(
      cardForBlueprintInstance(content, state, instanceId),
    )) {
      categoriesInHand.add(category);
    }
  }
  for (const category of BLUEPRINT_PITY_CATEGORIES) {
    pity[category] = categoriesInHand.has(category)
      ? 0
      : Math.max(0, content.balance.blueprintPityDraws - 1);
  }
}

/** 抽取蓝图并发送真实事件。 */
export function drawBlueprint(
  content: ContentPack,
  state: MatchState,
  player: PlayerState,
  shuffle: <T>(values: readonly T[]) => T[],
  emit: EmitEvent,
): boolean {
  refillBlueprintDeck(player, shuffle);
  if (player.blueprintDeck.length === 0) {
    emit({
      type: "draw_skipped",
      payload: { seatId: player.seatId, deck: "blueprint", reason: "empty" },
    });
    return false;
  }

  const pity = ensureBlueprintPity(player);
  for (const category of BLUEPRINT_PITY_CATEGORIES) {
    pity[category] += 1;
  }
  const dueCategories = [...BLUEPRINT_PITY_CATEGORIES]
    .filter((category) => pity[category] >= content.balance.blueprintPityDraws)
    .sort((left, right) => pity[right] - pity[left]);
  let selectedIndex = 0;
  let triggeredCategory: BlueprintPityCategory | undefined;
  for (const category of dueCategories) {
    const index = findPityCardIndex(content, state, player, category);
    if (index < 0) {
      continue;
    }
    selectedIndex = index;
    triggeredCategory = category;
    break;
  }
  const [cardInstanceId] = player.blueprintDeck.splice(selectedIndex, 1);
  if (cardInstanceId === undefined) {
    throw new Error("蓝图保底抽牌越界");
  }
  player.blueprintHand.push(cardInstanceId);
  const card = cardForBlueprintInstance(content, state, cardInstanceId);
  for (const category of blueprintPityCategories(card)) {
    pity[category] = 0;
  }
  emit({
    type: "blueprint_drawn",
    payload: {
      seatId: player.seatId,
      cardInstanceId,
      cardId: card.id,
    },
  });
  if (triggeredCategory) {
    emit({
      type: "blueprint_pity_triggered",
      payload: {
        seatId: player.seatId,
        category: triggeredCategory,
        cardId: card.id,
      },
    });
  }
  return true;
}

/** 抽取行动并记录来源据点。 */
export function drawAction(
  content: ContentPack,
  state: MatchState,
  player: PlayerState,
  randomInt: (min: number, max: number) => number,
  emit: EmitEvent,
): ActionInstance | null {
  const pool = buildActionPool(content, state, player.seatId);
  if (pool.length === 0) {
    emit({
      type: "draw_skipped",
      payload: { seatId: player.seatId, deck: "action", reason: "empty" },
    });
    return null;
  }
  const selected = pool[randomInt(0, pool.length - 1)];
  if (!selected) {
    throw new Error("行动池抽样越界");
  }
  player.nextActionInstanceOrdinal += 1;
  const instance: ActionInstance = {
    id: `action-${player.seatId}-${player.nextActionInstanceOrdinal}`,
    cardId: selected.cardId,
    ...(selected.sourceAnchorId ? { sourceAnchorId: selected.sourceAnchorId } : {}),
  };
  player.actionHand.push(instance);
  emit({
    type: "action_drawn",
    payload: {
      seatId: player.seatId,
      actionInstanceId: instance.id,
      cardId: instance.cardId,
      ...(instance.sourceAnchorId ? { sourceAnchorId: instance.sourceAnchorId } : {}),
    },
  });
  return instance;
}

/** 从蓝图手牌返回指定实例，并洗回牌堆。 */
export function returnBlueprintCards(
  player: PlayerState,
  cardInstanceIds: readonly string[],
  shuffle: <T>(values: readonly T[]) => T[],
): void {
  const selected = new Set(cardInstanceIds);
  const returned = player.blueprintHand.filter((instanceId) => selected.has(instanceId));
  player.blueprintHand = player.blueprintHand.filter((instanceId) => !selected.has(instanceId));
  player.blueprintDeck = [...player.blueprintDeck, ...shuffle(returned)];
}

/** 需要行动卡类型时提供显式校验，避免静态类型偷换。 */
export function requireActionCard(content: ContentPack, cardId: string): ActionCard {
  const card = requireCard(content, cardId);
  if (!isActionCard(card)) {
    throw new Error(`卡牌不是行动：${cardId}`);
  }
  return card;
}

/** 返回动态行动池的公开组成统计。 */
export function getActionPoolComposition(
  content: ContentPack,
  state: MatchState,
  seatId: string,
): readonly {
  readonly subtype: string;
  readonly count: number;
}[] {
  const counts = new Map<string, number>();
  for (const entry of buildActionPool(content, state, seatId)) {
    const action = requireActionCard(content, entry.cardId);
    counts.set(action.subtype, (counts.get(action.subtype) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([subtype, count]) => ({ subtype, count }))
    .sort((left, right) => left.subtype.localeCompare(right.subtype));
}
