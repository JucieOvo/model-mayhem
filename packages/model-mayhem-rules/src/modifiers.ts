/**
 * 费用、资源曲线、容量和模型得分的统一计算。
 *
 * 作者：JucieOvo
 *
 * 所有修正都从场上组织、资产、持续状态和限时效果推导，并保留来源。界面和
 * Agent 工具读取同一计算结果，不能各写一套公式。
 */

import type {
  Ability,
  Card,
  CardSelector,
  ContentPack,
  Effect,
  ModelCard,
} from "@modelmayhem/model-mayhem-content";
import {
  cardToSelectorContext,
  matchesSelector,
  requireAsset,
  requireOrganization,
} from "./selectors";
import type { AnchorCapacity, CostAdjustment, FinalCost, MatchState, PlayerState } from "./types";

interface ActiveEffect {
  readonly sourceCardId: string;
  readonly effect: Effect;
  readonly origin: "passive" | "timed";
  readonly sourceAnchorId?: string;
  readonly sourceModelInstanceId?: string;
  readonly targetAnchorId?: string;
  readonly targetModelInstanceId?: string;
}

function hasActiveStatus(
  statuses: readonly { readonly id: string; readonly pending: boolean }[],
  statusId: string,
): boolean {
  return statuses.some((status) => status.id === statusId && !status.pending);
}

function passiveEffectsForSeat(
  content: ContentPack,
  state: MatchState,
  seatId: string,
): readonly ActiveEffect[] {
  const effects: ActiveEffect[] = [];
  for (const anchor of Object.values(state.anchors)) {
    if (anchor.ownerSeatId !== seatId || anchor.isHomeLab || anchor.organizationCardId === null) {
      continue;
    }
    const organization = requireOrganization(content, anchor.organizationCardId);
    const regulationDisables = hasActiveStatus(anchor.statuses, "regulation");
    for (const effect of organization.passiveEffects) {
      if (
        regulationDisables &&
        (organization.openness === "closed" || organization.tags.includes("frontier"))
      ) {
        continue;
      }
      effects.push({
        sourceCardId: organization.id,
        effect,
        origin: "passive",
        sourceAnchorId: anchor.id,
      });
    }
  }

  for (const asset of Object.values(state.assets)) {
    if (asset.ownerSeatId !== seatId) {
      continue;
    }
    const card = requireAsset(content, asset.cardId);
    const anchor = state.anchors[asset.anchorId];
    if (!anchor || hasActiveStatus(anchor.statuses, "outage")) {
      continue;
    }
    for (const effect of card.passiveEffects) {
      effects.push({
        sourceCardId: card.id,
        effect,
        origin: "passive",
        sourceAnchorId: asset.anchorId,
        ...(asset.attachedModelInstanceId
          ? { sourceModelInstanceId: asset.attachedModelInstanceId }
          : {}),
      });
    }
  }
  return effects;
}

function timedEffectsForSeat(player: PlayerState, currentRound: number): readonly ActiveEffect[] {
  return player.timedModifiers
    .filter((modifier) => modifier.expiresAtRound >= currentRound)
    .map((modifier) => ({
      sourceCardId: modifier.sourceCardId,
      effect: modifier.effect,
      origin: "timed" as const,
      ...(modifier.targetAnchorId ? { targetAnchorId: modifier.targetAnchorId } : {}),
      ...(modifier.targetModelInstanceId
        ? { targetModelInstanceId: modifier.targetModelInstanceId }
        : {}),
    }));
}

function allEffectsForSeat(
  content: ContentPack,
  state: MatchState,
  seatId: string,
): readonly ActiveEffect[] {
  const player = state.players[seatId];
  if (!player) {
    throw new Error(`缺少玩家：${seatId}`);
  }
  return [
    ...passiveEffectsForSeat(content, state, seatId),
    ...timedEffectsForSeat(player, state.round),
  ];
}

function selectorMatchesCard(selector: CardSelector, card: Card): boolean {
  return matchesSelector(selector, cardToSelectorContext(card));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function determineMinimumCost(card: Card): { readonly compute: number; readonly capital: number } {
  if (card.type === "organization") {
    return { compute: 0, capital: 1 };
  }
  if (card.type === "asset" && card.subtype === "model") {
    return { compute: 1, capital: 0 };
  }
  return { compute: 0, capital: 0 };
}

/**
 * 计算一张牌的最终费用。
 *
 * `deploymentAnchorId` 和 `isAction` 用于处理过载与势头这类依赖行动语境的
 * 状态。费用修正按单卡总减免和总增加分别限制在三以内。
 */
export function getFinalCost(
  content: ContentPack,
  state: MatchState,
  seatId: string,
  card: Card,
  options: {
    readonly deploymentAnchorId?: string;
    readonly isAction?: boolean;
  } = {},
): FinalCost {
  const adjustments: CostAdjustment[] = [];
  for (const activeEffect of allEffectsForSeat(content, state, seatId)) {
    const effect = activeEffect.effect;
    if (
      effect.kind !== "modify_cost" ||
      effect.target !== "self" ||
      activeEffect.sourceModelInstanceId !== undefined ||
      activeEffect.targetModelInstanceId !== undefined ||
      (activeEffect.targetAnchorId !== undefined &&
        activeEffect.targetAnchorId !== options.deploymentAnchorId) ||
      !selectorMatchesCard(effect.selector, card)
    ) {
      continue;
    }
    adjustments.push({
      source: activeEffect.sourceCardId,
      resource: effect.resource,
      amount: effect.amount,
      kind: activeEffect.origin === "timed" ? "event" : "card",
    });
  }

  if (options.isAction) {
    const player = state.players[seatId];
    if (!player) {
      throw new Error(`缺少玩家：${seatId}`);
    }
    if (hasPlayerStatus(state, player, "momentum")) {
      adjustments.push({
        source: "momentum",
        resource: "compute",
        amount: -1,
        kind: "status",
      });
    }
  }

  if (
    card.type === "asset" &&
    card.subtype === "model" &&
    options.deploymentAnchorId !== undefined
  ) {
    const anchor = state.anchors[options.deploymentAnchorId];
    if (anchor && hasActiveStatus(anchor.statuses, "overload")) {
      adjustments.push({
        source: "overload",
        resource: "compute",
        amount: 1,
        kind: "status",
      });
    }
  }

  const computeAdjustment = clampInteger(
    adjustments
      .filter((adjustment) => adjustment.resource === "compute")
      .reduce((total, adjustment) => total + adjustment.amount, 0),
    content.balance.costAdjustment.minimum,
    content.balance.costAdjustment.maximum,
  );
  const capitalAdjustment = clampInteger(
    adjustments
      .filter((adjustment) => adjustment.resource === "capital")
      .reduce((total, adjustment) => total + adjustment.amount, 0),
    content.balance.costAdjustment.minimum,
    content.balance.costAdjustment.maximum,
  );
  const minimum = determineMinimumCost(card);
  return {
    compute: Math.max(minimum.compute, card.cost.compute + computeAdjustment),
    capital: Math.max(minimum.capital, card.cost.capital + capitalAdjustment),
    adjustments,
  };
}

/** 判断玩家是否能支付最终费用。 */
export function canAfford(
  player: PlayerState,
  cost: Pick<FinalCost, "compute" | "capital">,
): boolean {
  return player.compute >= cost.compute && player.capital >= cost.capital;
}

/**
 * 计算指定座位的算力上限。
 *
 * 默认使用玩家当前已经进入的回合序号；视图预览下回合空间时可显式传入下一回合
 * 序号，公式与正式开始阶段保持同一条实现。
 */
export function getComputeCeiling(
  content: ContentPack,
  state: MatchState,
  seatId: string,
  projectedTurnNumber?: number,
): number {
  const player = state.players[seatId];
  if (!player) {
    throw new Error(`缺少玩家：${seatId}`);
  }
  let value = Math.min(
    content.balance.computeLimit,
    content.balance.computeBase + (projectedTurnNumber ?? player.turnNumber),
  );
  for (const activeEffect of allEffectsForSeat(content, state, seatId)) {
    if (
      activeEffect.effect.kind === "modify_compute_ceiling" &&
      activeEffect.effect.target === "self"
    ) {
      value += activeEffect.effect.amount;
    }
  }
  return clampInteger(value, 0, content.balance.computeLimit);
}

/** 计算开始阶段获得的资本收入。 */
export function getCapitalIncome(content: ContentPack, state: MatchState, seatId: string): number {
  let income = content.balance.capitalBaseIncome;
  for (const anchor of Object.values(state.anchors)) {
    if (
      anchor.ownerSeatId !== seatId ||
      anchor.isHomeLab ||
      anchor.organizationCardId === null ||
      hasActiveStatus(anchor.statuses, "outage")
    ) {
      continue;
    }
    income += requireOrganization(content, anchor.organizationCardId).capitalIncome;
  }
  for (const activeEffect of allEffectsForSeat(content, state, seatId)) {
    if (activeEffect.effect.kind === "modify_income" && activeEffect.effect.target === "self") {
      income += activeEffect.effect.amount;
    }
  }
  return Math.max(0, income);
}

/** 计算指定据点的最终资产容量。 */
export function getAnchorCapacity(
  content: ContentPack,
  state: MatchState,
  anchorId: string,
): AnchorCapacity {
  const anchor = state.anchors[anchorId];
  if (!anchor) {
    throw new Error(`据点不存在：${anchorId}`);
  }
  let base = content.balance.homeLabCapacity;
  if (!anchor.isHomeLab) {
    if (anchor.organizationCardId === null) {
      throw new Error(`组织据点缺少卡牌：${anchorId}`);
    }
    base = requireOrganization(content, anchor.organizationCardId).capacity;
  }

  let adjustment = 0;
  for (const activeEffect of allEffectsForSeat(content, state, anchor.ownerSeatId)) {
    const effect = activeEffect.effect;
    if (effect.kind !== "modify_capacity") {
      continue;
    }
    if (effect.target === "self_active_anchor") {
      if (activeEffect.targetAnchorId !== undefined && activeEffect.targetAnchorId !== anchorId) {
        continue;
      }
      if (activeEffect.sourceAnchorId !== undefined && activeEffect.sourceAnchorId !== anchorId) {
        continue;
      }
      if (activeEffect.sourceModelInstanceId !== undefined) {
        continue;
      }
      adjustment += effect.amount;
    }
  }
  return {
    base,
    final: Math.max(1, base + adjustment),
  };
}

/** 判断玩家是否有权部署跨阵营闭源模型。 */
export function hasCrossFactionClosedAccess(
  content: ContentPack,
  state: MatchState,
  seatId: string,
): boolean {
  return allEffectsForSeat(content, state, seatId).some(
    (activeEffect) =>
      activeEffect.effect.kind === "allow_cross_faction_closed" &&
      activeEffect.effect.target === "self",
  );
}

/** 判断玩家自身状态中是否存在有效状态。 */
export function hasPlayerStatus(
  _state: MatchState,
  player: PlayerState,
  statusId: string,
): boolean {
  return hasActiveStatus(player.statuses, statusId);
}

function targetHasStatus(
  statuses: readonly { readonly id: string; readonly pending: boolean }[],
  statusId: string,
): boolean {
  return hasActiveStatus(statuses, statusId);
}

/** 计算模型在指定能力下的最终得分和逐项来源。 */
export function getModelScore(
  content: ContentPack,
  state: MatchState,
  seatId: string,
  modelInstanceId: string,
  ability: Ability,
): {
  readonly base: number;
  readonly final: number;
  readonly adjustments: readonly {
    readonly source: string;
    readonly amount: number;
  }[];
} {
  const asset = state.assets[modelInstanceId];
  if (!asset || asset.ownerSeatId !== seatId) {
    throw new Error(`模型不属于该玩家：${modelInstanceId}`);
  }
  const model = requireAsset(content, asset.cardId);
  if (model.assetKind !== "model") {
    throw new Error(`资产不是模型：${asset.cardId}`);
  }
  const base = (model as ModelCard).abilities[ability];
  if (
    base < content.balance.modelScore.baseMinimum ||
    base > content.balance.modelScore.baseMaximum
  ) {
    throw new Error(`模型基础能力超出规则范围：${model.id}/${ability}/${base}`);
  }
  const adjustments: { source: string; amount: number }[] = [];
  const regulationDisablesModifiers = targetHasStatus(asset.statuses, "regulation");

  if (!regulationDisablesModifiers) {
    for (const activeEffect of allEffectsForSeat(content, state, seatId)) {
      const effect = activeEffect.effect;
      if (
        effect.kind !== "modify_model_score" ||
        effect.target !== "self" ||
        (activeEffect.sourceModelInstanceId !== undefined &&
          activeEffect.sourceModelInstanceId !== modelInstanceId) ||
        (activeEffect.targetModelInstanceId !== undefined &&
          activeEffect.targetModelInstanceId !== modelInstanceId) ||
        (effect.ability !== undefined && effect.ability !== ability) ||
        !selectorMatchesCard(effect.selector, model)
      ) {
        continue;
      }
      adjustments.push({
        source: activeEffect.sourceCardId,
        amount: effect.amount,
      });
    }
  }

  if (targetHasStatus(asset.statuses, "heat")) {
    adjustments.push({ source: "heat", amount: 1 });
  }
  if (targetHasStatus(asset.statuses, "controversy")) {
    adjustments.push({ source: "controversy", amount: -1 });
  }
  if (targetHasStatus(asset.statuses, "training")) {
    adjustments.push({ source: "training", amount: 1 });
  }

  const modifierTotal = clampInteger(
    adjustments.reduce((total, adjustment) => total + adjustment.amount, 0),
    content.balance.modelScore.modifierMinimum,
    content.balance.modelScore.modifierMaximum,
  );
  return {
    base,
    final: clampInteger(
      base + modifierTotal,
      content.balance.modelScore.finalMinimum,
      content.balance.modelScore.finalMaximum,
    ),
    adjustments,
  };
}

/** 计算无对手参赛时的公开门槛。 */
export function getOpenBenchmarkThreshold(content: ContentPack, round: number): number {
  const benchmark = content.balance.benchmark;
  return Math.min(
    benchmark.openMaximum,
    benchmark.openBase + Math.floor((Math.max(1, round) - 1) / benchmark.openRoundStep),
  );
}
