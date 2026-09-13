/**
 * 结构化卡牌效果解释器。
 *
 * 作者：JucieOvo
 *
 * 解释器只接受内容包中定义的效果联合类型。即时效果直接修改真实状态；持续
 * 效果写入带来源和到期轮次的修正记录，供费用、得分和容量计算统一读取。
 */

import type { ContentPack, Effect, StatusId, TargetRole } from "@modelmayhem/model-mayhem-content";
import { resolveBenchmark } from "./benchmark";
import type { EmitEvent } from "./mutations";
import {
  gainInfluence,
  grantAnchorStatus,
  grantModelStatus,
  grantPlayerStatus,
  modifyResources,
  removeStatuses,
  stealInfluence,
} from "./mutations";
import { drawAction, drawBlueprint } from "./pool";
import type {
  ActionInstance,
  EffectTargets,
  MatchState,
  ResolvedTarget,
  TimedModifier,
} from "./types";

interface ApplyEffectContext {
  readonly content: ContentPack;
  readonly state: MatchState;
  readonly sourceSeatId: string;
  readonly sourceCardId: string;
  readonly sourceInstanceId: string;
  readonly sourceAnchorId?: string;
  readonly sourceModelInstanceId?: string;
  readonly targets: EffectTargets;
  readonly emit: EmitEvent;
  readonly shuffle: <T>(values: readonly T[]) => T[];
  readonly randomInt: (min: number, max: number) => number;
  readonly durationOverride?: number;
  readonly deferWinCheck?: boolean;
}

function findDefaultAnchor(
  state: MatchState,
  seatId: string,
  includeHomeLab: boolean,
): string | undefined {
  const anchors = Object.values(state.anchors).filter(
    (anchor) => anchor.ownerSeatId === seatId && (includeHomeLab || !anchor.isHomeLab),
  );
  anchors.sort((left, right) => {
    if (left.isHomeLab !== right.isHomeLab) {
      return left.isHomeLab ? 1 : -1;
    }
    return (left.slotIndex ?? -1) - (right.slotIndex ?? -1);
  });
  return anchors[0]?.id;
}

function findDefaultModel(
  state: MatchState,
  seatId: string,
  anchorId?: string,
): string | undefined {
  return Object.values(state.assets).find(
    (asset) =>
      asset.ownerSeatId === seatId && (anchorId === undefined || asset.anchorId === anchorId),
  )?.instanceId;
}

function resolveTarget(
  targetRole: TargetRole,
  targets: EffectTargets,
  state: MatchState,
): ResolvedTarget | undefined {
  const selfAnchorId = targets.selfAnchorId ?? findDefaultAnchor(state, targets.selfSeatId, true);
  const opponentAnchorId =
    targets.opponentAnchorId ?? findDefaultAnchor(state, targets.opponentSeatId, true);
  switch (targetRole) {
    case "self":
      return { ownerSeatId: targets.selfSeatId };
    case "opponent":
      return { ownerSeatId: targets.opponentSeatId };
    case "self_active_anchor":
      return selfAnchorId === undefined
        ? undefined
        : { ownerSeatId: targets.selfSeatId, anchorId: selfAnchorId };
    case "opponent_active_anchor":
      return opponentAnchorId === undefined
        ? undefined
        : { ownerSeatId: targets.opponentSeatId, anchorId: opponentAnchorId };
    case "self_active_model": {
      const modelId =
        targets.selfModelInstanceId ?? findDefaultModel(state, targets.selfSeatId, selfAnchorId);
      return modelId === undefined
        ? undefined
        : {
            ownerSeatId: targets.selfSeatId,
            modelInstanceId: modelId,
            ...(state.assets[modelId]?.anchorId
              ? { anchorId: state.assets[modelId]?.anchorId }
              : {}),
          };
    }
    case "opponent_active_model": {
      const modelId =
        targets.opponentModelInstanceId ??
        findDefaultModel(state, targets.opponentSeatId, opponentAnchorId);
      return modelId === undefined
        ? undefined
        : {
            ownerSeatId: targets.opponentSeatId,
            modelInstanceId: modelId,
            ...(state.assets[modelId]?.anchorId
              ? { anchorId: state.assets[modelId]?.anchorId }
              : {}),
          };
    }
  }
}

function sourceResourceTarget(target: "self" | "opponent", targets: EffectTargets): string {
  return target === "self" ? targets.selfSeatId : targets.opponentSeatId;
}

function storeTimedModifier(
  context: ApplyEffectContext,
  targetSeatId: string,
  effect: Effect,
  targetAnchorId?: string,
  targetModelInstanceId?: string,
): void {
  if (context.state.phase === "finished") {
    return;
  }
  const player = context.state.players[targetSeatId];
  if (!player) {
    throw new Error(`持续性效果目标玩家不存在：${targetSeatId}`);
  }
  const duration =
    context.durationOverride ?? ("durationRounds" in effect ? effect.durationRounds : 1);
  const modifier: TimedModifier = {
    id: `${context.sourceInstanceId}:${effect.kind}`,
    sourceCardId: context.sourceCardId,
    effect,
    expiresAtRound: context.state.round + duration - 1,
    ...(targetAnchorId ? { targetAnchorId } : {}),
    ...(targetModelInstanceId ? { targetModelInstanceId } : {}),
  };
  const duplicateIndex = player.timedModifiers.findIndex(
    (candidate) =>
      candidate.id === modifier.id &&
      candidate.targetAnchorId === modifier.targetAnchorId &&
      candidate.targetModelInstanceId === modifier.targetModelInstanceId,
  );
  if (duplicateIndex >= 0) {
    player.timedModifiers[duplicateIndex] = modifier;
  } else {
    player.timedModifiers.push(modifier);
  }
}

function applyGainInfluence(
  context: ApplyEffectContext,
  effect: Extract<Effect, { kind: "gain_influence" }>,
): void {
  const targetSeatId = sourceResourceTarget(effect.target, context.targets);
  const player = context.state.players[targetSeatId];
  if (!player) {
    throw new Error(`影响力目标玩家不存在：${targetSeatId}`);
  }
  if (effect.frequency === "once_per_round") {
    const persistentSourceId = context.sourceAnchorId ?? context.sourceModelInstanceId;
    const sourceKey =
      persistentSourceId === undefined
        ? `card:${context.sourceCardId}`
        : `source:${persistentSourceId}:${context.sourceCardId}`;
    if (player.influenceSourceIdsThisRound.includes(sourceKey)) {
      return;
    }
    player.influenceSourceIdsThisRound.push(sourceKey);
  }
  const anchorHasControversy =
    context.sourceAnchorId !== undefined &&
    context.state.anchors[context.sourceAnchorId]?.statuses.some(
      (status) => status.id === "controversy" && !status.pending,
    ) === true;
  const modelHasControversy =
    context.sourceModelInstanceId !== undefined &&
    context.state.assets[context.sourceModelInstanceId]?.statuses.some(
      (status) => status.id === "controversy" && !status.pending,
    ) === true;
  const amount =
    anchorHasControversy || modelHasControversy ? Math.max(0, effect.amount - 1) : effect.amount;
  gainInfluence(
    context.content,
    context.state,
    targetSeatId,
    amount,
    context.sourceCardId,
    context.emit,
    context.deferWinCheck ?? false,
  );
}

function applyStatusEffect(
  context: ApplyEffectContext,
  target: ResolvedTarget,
  status: StatusId,
  durationTurns: number,
): void {
  if (target.modelInstanceId !== undefined) {
    const asset = context.state.assets[target.modelInstanceId];
    if (!asset) {
      throw new Error(`状态目标模型不存在：${target.modelInstanceId}`);
    }
    grantModelStatus(
      context.content,
      context.state,
      asset,
      status,
      context.sourceCardId,
      durationTurns,
      context.emit,
    );
    return;
  }
  if (target.anchorId !== undefined) {
    const anchor = context.state.anchors[target.anchorId];
    if (!anchor) {
      throw new Error(`状态目标据点不存在：${target.anchorId}`);
    }
    grantAnchorStatus(
      context.content,
      context.state,
      anchor,
      status,
      context.sourceCardId,
      durationTurns,
      context.targets.statusReplacementId,
      context.emit,
    );
    return;
  }
  grantPlayerStatus(
    context.state,
    target.ownerSeatId,
    status,
    context.sourceCardId,
    durationTurns,
    context.emit,
  );
}

function applyRemoveStatusEffect(
  context: ApplyEffectContext,
  target: ResolvedTarget,
  status: StatusId,
  maxCount: number,
): void {
  if (target.modelInstanceId !== undefined) {
    const asset = context.state.assets[target.modelInstanceId];
    if (!asset) {
      throw new Error(`状态目标模型不存在：${target.modelInstanceId}`);
    }
    removeStatuses(asset.statuses, asset.instanceId, status, maxCount, context.emit);
    return;
  }
  if (target.anchorId !== undefined) {
    const anchor = context.state.anchors[target.anchorId];
    if (!anchor) {
      throw new Error(`状态目标据点不存在：${target.anchorId}`);
    }
    removeStatuses(anchor.statuses, anchor.id, status, maxCount, context.emit);
    return;
  }
  const player = context.state.players[target.ownerSeatId];
  if (!player) {
    throw new Error(`状态目标玩家不存在：${target.ownerSeatId}`);
  }
  removeStatuses(player.statuses, player.seatId, status, maxCount, context.emit);
}

function applyDrawEffect(
  context: ApplyEffectContext,
  targetSeatId: string,
  deck: "blueprint" | "action",
  amount: number,
): void {
  const player = context.state.players[targetSeatId];
  if (!player) {
    throw new Error(`抽牌目标玩家不存在：${targetSeatId}`);
  }
  for (let count = 0; count < amount; count += 1) {
    if (deck === "blueprint") {
      drawBlueprint(context.content, context.state, player, context.shuffle, context.emit);
    } else {
      drawAction(context.content, context.state, player, context.randomInt, context.emit);
    }
  }
}

function applyEffectAttack(
  context: ApplyEffectContext,
  effect: Extract<Effect, { kind: "effect_attack" }>,
): void {
  const targetSeatId = context.targets.opponentSeatId;
  const target =
    effect.target === "opponent"
      ? { ownerSeatId: targetSeatId }
      : resolveTarget(effect.target, context.targets, context.state);
  if (!target) {
    return;
  }

  let appliedAmount = effect.amount;
  switch (effect.attackType) {
    case "compute_pressure": {
      const player = context.state.players[targetSeatId];
      if (!player) {
        throw new Error(`算力压制目标玩家不存在：${targetSeatId}`);
      }
      const before = player.compute;
      modifyResources(context.content, context.state, targetSeatId, "compute", -effect.amount);
      appliedAmount = before - player.compute;
      break;
    }
    case "capital_pressure": {
      const player = context.state.players[targetSeatId];
      if (!player) {
        throw new Error(`资本挤压目标玩家不存在：${targetSeatId}`);
      }
      const before = player.capital;
      modifyResources(context.content, context.state, targetSeatId, "capital", -effect.amount);
      appliedAmount = before - player.capital;
      break;
    }
    case "score_pressure": {
      if (!target.modelInstanceId) {
        return;
      }
      storeTimedModifier(
        context,
        target.ownerSeatId,
        {
          kind: "modify_model_score",
          target: "self",
          amount: -effect.amount,
          durationRounds: effect.durationTurns,
          selector: effect.selector ?? {},
        },
        target.anchorId,
        target.modelInstanceId,
      );
      break;
    }
    case "status_pressure": {
      if (!effect.status) {
        throw new Error("状态攻击缺少状态标识");
      }
      applyStatusEffect(context, target, effect.status, effect.durationTurns);
      appliedAmount = 1;
      break;
    }
    case "cost_pressure": {
      if (!effect.selector) {
        throw new Error("费用污染缺少结构化选择器");
      }
      storeTimedModifier(
        context,
        targetSeatId,
        {
          kind: "modify_cost",
          target: "self",
          resource: "compute",
          amount: effect.amount,
          durationRounds: effect.durationTurns,
          selector: effect.selector,
        },
        target.anchorId,
        target.modelInstanceId,
      );
      break;
    }
    case "influence_pressure": {
      appliedAmount = stealInfluence(
        context.content,
        context.state,
        context.targets.selfSeatId,
        targetSeatId,
        1,
        context.emit,
        context.deferWinCheck ?? false,
      );
      break;
    }
  }

  context.emit({
    type: "effect_attack_resolved",
    payload: {
      sourceSeatId: context.targets.selfSeatId,
      targetSeatId,
      attackType: effect.attackType,
      targetId: target.modelInstanceId ?? target.anchorId ?? target.ownerSeatId,
      amount: appliedAmount,
    },
  });
}

function applySingleEffect(context: ApplyEffectContext, effect: Effect): void {
  if (context.state.phase === "finished") {
    return;
  }
  switch (effect.kind) {
    case "effect_attack":
      applyEffectAttack(context, effect);
      return;
    case "modify_resource":
      modifyResources(
        context.content,
        context.state,
        sourceResourceTarget(effect.target, context.targets),
        effect.resource,
        effect.amount,
      );
      return;
    case "gain_influence":
      applyGainInfluence(context, effect);
      return;
    case "steal_influence":
      stealInfluence(
        context.content,
        context.state,
        context.targets.selfSeatId,
        context.targets.opponentSeatId,
        effect.amount,
        context.emit,
        context.deferWinCheck ?? false,
      );
      return;
    case "draw":
      applyDrawEffect(
        context,
        sourceResourceTarget(effect.target, context.targets),
        effect.deck,
        effect.amount,
      );
      return;
    case "grant_status": {
      const target = resolveTarget(effect.target, context.targets, context.state);
      if (!target) {
        return;
      }
      applyStatusEffect(context, target, effect.status, effect.durationTurns);
      return;
    }
    case "remove_status": {
      const target = resolveTarget(effect.target, context.targets, context.state);
      if (!target) {
        return;
      }
      applyRemoveStatusEffect(context, target, effect.status, effect.maxCount);
      return;
    }
    case "modify_cost":
    case "modify_income":
    case "modify_model_score":
    case "modify_compute_ceiling":
    case "allow_cross_faction_closed":
      storeTimedModifier(context, sourceResourceTarget(effect.target, context.targets), effect);
      return;
    case "modify_capacity": {
      const target = resolveTarget(effect.target, context.targets, context.state);
      if (!target) {
        return;
      }
      storeTimedModifier(
        context,
        target.ownerSeatId,
        effect,
        target.anchorId,
        target.modelInstanceId,
      );
      return;
    }
    case "benchmark": {
      if (context.targets.selfModelInstanceId === undefined) {
        throw new Error("Benchmark 缺少主动模型");
      }
      resolveBenchmark(
        context.content,
        context.state,
        context.targets.selfSeatId,
        context.targets.selfModelInstanceId,
        effect.ability,
        effect.benchmarkType,
        context.emit,
      );
      return;
    }
  }
}

/** 依次应用效果列表，每个原子效果结束后都允许终止后续结算。 */
export function applyEffects(context: ApplyEffectContext, effects: readonly Effect[]): void {
  for (let index = 0; index < effects.length; index += 1) {
    const effect = effects[index];
    if (!effect || context.state.phase === "finished") {
      break;
    }
    applySingleEffect(
      {
        ...context,
        sourceInstanceId: `${context.sourceInstanceId}:${index + 1}`,
      },
      effect,
    );
  }
}

/** 创建行动效果需要使用的目标集合。 */
export function createEffectTargets(
  state: MatchState,
  selfSeatId: string,
  action: ActionInstance,
  targetAnchorId?: string,
  targetModelInstanceId?: string,
  benchmarkModelInstanceId?: string,
  statusReplacementId?: StatusId,
): EffectTargets {
  const opponentSeatId = state.seats.find((seatId) => seatId !== selfSeatId);
  if (!opponentSeatId) {
    throw new Error(`行动缺少对手座位：${selfSeatId}`);
  }
  const selfAnchor =
    state.anchors[targetAnchorId ?? ""]?.ownerSeatId === selfSeatId ? targetAnchorId : undefined;
  const opponentAnchor =
    state.anchors[targetAnchorId ?? ""]?.ownerSeatId === opponentSeatId
      ? targetAnchorId
      : undefined;
  const selfModel =
    state.assets[targetModelInstanceId ?? ""]?.ownerSeatId === selfSeatId
      ? targetModelInstanceId
      : undefined;
  const opponentModel =
    state.assets[targetModelInstanceId ?? ""]?.ownerSeatId === opponentSeatId
      ? targetModelInstanceId
      : undefined;
  const sourceAnchor =
    action.sourceAnchorId !== undefined &&
    state.anchors[action.sourceAnchorId]?.ownerSeatId === selfSeatId
      ? action.sourceAnchorId
      : undefined;
  const effectiveSelfAnchor = selfAnchor ?? sourceAnchor;
  return {
    selfSeatId,
    opponentSeatId,
    ...(effectiveSelfAnchor ? { selfAnchorId: effectiveSelfAnchor } : {}),
    ...(opponentAnchor ? { opponentAnchorId: opponentAnchor } : {}),
    ...(selfModel ? { selfModelInstanceId: selfModel } : {}),
    ...(opponentModel ? { opponentModelInstanceId: opponentModel } : {}),
    ...(benchmarkModelInstanceId ? { selfModelInstanceId: benchmarkModelInstanceId } : {}),
    ...(statusReplacementId ? { statusReplacementId } : {}),
  };
}
