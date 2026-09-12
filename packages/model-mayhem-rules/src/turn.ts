/**
 * 轮次、回合、世界事件和终局比较。
 *
 * 作者：JucieOvo
 *
 * 开始、抽牌、主要和结束阶段由此模块统一推进。客户端不维护阶段状态，也不能
 * 通过连续请求跳过资源恢复、状态到期或世界事件触发。
 */

import type { ContentPack, Effect, WorldEventCard } from "@modelmayhem/model-mayhem-content";
import { applyEffects } from "./effects";
import { getCapitalIncome, getComputeCeiling } from "./modifiers";
import type { EmitEvent } from "./mutations";
import { finishMatch } from "./mutations";
import { drawAction, drawBlueprint, initializeBlueprintPity } from "./pool";
import {
  cardToSelectorContext,
  matchesSelector,
  requireCard,
  requireOrganization,
} from "./selectors";
import type { EffectTargets, MatchState, PlayerState, StatusState } from "./types";

interface TurnContext {
  readonly content: ContentPack;
  readonly state: MatchState;
  readonly emit: EmitEvent;
  readonly shuffle: <T>(values: readonly T[]) => T[];
  readonly randomInt: (min: number, max: number) => number;
}

function opponentSeatFor(state: MatchState, seatId: string): string {
  const opponent = state.seats.find((candidate) => candidate !== seatId);
  if (!opponent) {
    throw new Error(`对局缺少 ${seatId} 的对手`);
  }
  return opponent;
}

function effectTargetsFor(state: MatchState, seatId: string): EffectTargets {
  return {
    selfSeatId: seatId,
    opponentSeatId: opponentSeatFor(state, seatId),
  };
}

function triggerEffects(
  context: TurnContext,
  seatId: string,
  trigger:
    | "organization_deployed"
    | "asset_deployed"
    | "model_deployed"
    | "technology_installed"
    | "turn_started"
    | "benchmark_won",
  cardIdFilter?: string,
): void {
  for (const anchor of Object.values(context.state.anchors)) {
    if (anchor.ownerSeatId !== seatId || anchor.isHomeLab || anchor.organizationCardId === null) {
      continue;
    }
    const organization = requireOrganization(context.content, anchor.organizationCardId);
    for (const triggered of organization.triggeredEffects) {
      if (triggered.trigger !== trigger) {
        continue;
      }
      if (
        cardIdFilter !== undefined &&
        !matchesSelector(
          triggered.selector,
          cardToSelectorContext(requireCard(context.content, cardIdFilter)),
        )
      ) {
        continue;
      }
      applyEffects(
        {
          content: context.content,
          state: context.state,
          sourceSeatId: seatId,
          sourceCardId: organization.id,
          sourceInstanceId: anchor.id,
          sourceAnchorId: anchor.id,
          targets: effectTargetsFor(context.state, seatId),
          emit: context.emit,
          shuffle: context.shuffle,
          randomInt: context.randomInt,
        },
        triggered.effects,
      );
    }
  }
}

/** 处理开始阶段的持续效果。 */
export function applyStartOfTurnEffects(context: TurnContext, seatId: string): void {
  triggerEffects(context, seatId, "turn_started");
}

/** 处理部署后的领域触发。 */
export function applyDeploymentEffects(
  context: TurnContext,
  seatId: string,
  trigger: "organization_deployed" | "asset_deployed" | "model_deployed" | "technology_installed",
  deployedCardId: string,
): void {
  triggerEffects(context, seatId, trigger, deployedCardId);
}

function worldEventCard(content: ContentPack, cardId: string): WorldEventCard {
  const card = content.worldEvents.get(cardId);
  if (!card) {
    throw new Error(`世界事件内容不存在：${cardId}`);
  }
  return card;
}

function triggerWorldEvent(context: TurnContext): void {
  const previous = context.state.worldEvent;
  if (previous) {
    for (const player of Object.values(context.state.players)) {
      player.timedModifiers = player.timedModifiers.filter(
        (modifier) => modifier.sourceCardId !== previous.cardId,
      );
    }
  }

  if (context.state.worldEventQueue.length === 0) {
    context.state.worldEventQueue = context.shuffle([...context.content.worldEvents.keys()]);
  }
  const cardId = context.state.worldEventQueue.shift();
  if (!cardId) {
    throw new Error("世界事件队列为空");
  }
  const card = worldEventCard(context.content, cardId);
  context.state.worldEvent = {
    cardId,
    startedAtRound: context.state.round,
    expiresAfterRound: context.state.round + card.durationRounds - 1,
  };
  context.emit({
    type: "world_event_started",
    payload: {
      cardId,
      expiresAfterRound: context.state.worldEvent.expiresAfterRound,
    },
  });

  for (const seatId of context.state.seats) {
    applyEffects(
      {
        content: context.content,
        state: context.state,
        sourceSeatId: seatId,
        sourceCardId: card.id,
        sourceInstanceId: `event:${context.state.round}:${card.id}`,
        targets: effectTargetsFor(context.state, seatId),
        emit: context.emit,
        shuffle: context.shuffle,
        randomInt: context.randomInt,
        durationOverride: card.durationRounds,
      },
      card.effects,
    );
  }
}

/** 开始新的全局轮次，并在配置节点触发世界事件。 */
export function startRound(context: TurnContext): void {
  context.state.round += 1;
  context.state.turnOrderIndex = 0;
  for (const player of Object.values(context.state.players)) {
    player.influenceGainedThisRound = 0;
    player.influenceSourceIdsThisRound = [];
  }
  context.emit({
    type: "round_started",
    payload: { round: context.state.round },
  });

  if (
    context.state.worldEvent !== null &&
    context.state.worldEvent.expiresAfterRound < context.state.round
  ) {
    context.state.worldEvent = null;
  }
  if (context.content.balance.worldEventRounds.includes(context.state.round)) {
    triggerWorldEvent(context);
  }
}

/** 开始一个玩家回合，恢复资源、结算开始触发并抽牌。 */
export function startTurn(context: TurnContext): void {
  const seatId = context.state.seats[context.state.turnOrderIndex];
  if (!seatId) {
    throw new Error("回合顺序越界");
  }
  const player = context.state.players[seatId];
  if (!player) {
    throw new Error(`当前玩家不存在：${seatId}`);
  }
  context.state.activeSeatId = seatId;
  player.turnNumber += 1;
  player.organizationDeploysThisTurn = 0;
  player.assetDeploysThisTurn = 0;
  player.benchmarksThisTurn = 0;
  player.techChecksThisTurn = 0;
  player.compute = getComputeCeiling(context.content, context.state, seatId);
  player.capital = Math.min(
    context.content.balance.capitalLimit,
    player.capital + getCapitalIncome(context.content, context.state, seatId),
  );
  context.emit({
    type: "turn_started",
    payload: {
      seatId,
      round: context.state.round,
      turnNumber: player.turnNumber,
    },
  });
  applyStartOfTurnEffects(context, seatId);
  for (let count = 0; count < context.content.balance.blueprintDrawPerTurn; count += 1) {
    drawBlueprint(context.content, context.state, player, context.shuffle, context.emit);
  }
  for (let count = 0; count < context.content.balance.actionDrawPerTurn; count += 1) {
    drawAction(context.content, context.state, player, context.randomInt, context.emit);
  }
}

function expireStatuses(statuses: StatusState[], targetId: string, emit: EmitEvent): void {
  for (let index = statuses.length - 1; index >= 0; index -= 1) {
    const status = statuses[index];
    if (!status) {
      continue;
    }
    if (status.pending) {
      status.pending = false;
      continue;
    }
    status.remainingTurns -= 1;
    if (status.remainingTurns > 0) {
      continue;
    }
    statuses.splice(index, 1);
    emit({
      type: "status_removed",
      payload: { targetId, status: status.id, reason: "expired" },
    });
  }
}

function assertHandLimits(content: ContentPack, player: PlayerState): void {
  if (player.blueprintHand.length > content.balance.blueprintHandLimit) {
    throw new Error("蓝图手牌超过上限，必须先弃置再结束回合");
  }
  if (player.actionHand.length > content.balance.actionHandLimit) {
    throw new Error("行动手牌超过上限，必须先弃置再结束回合");
  }
}

function endActivePlayerStatuses(context: TurnContext, player: PlayerState): void {
  expireStatuses(player.statuses, player.seatId, context.emit);
  for (const anchor of Object.values(context.state.anchors)) {
    if (anchor.ownerSeatId === player.seatId) {
      expireStatuses(anchor.statuses, anchor.id, context.emit);
    }
  }
  for (const asset of Object.values(context.state.assets)) {
    if (asset.ownerSeatId === player.seatId) {
      expireStatuses(asset.statuses, asset.instanceId, context.emit);
    }
  }
}

function finishByComparison(context: TurnContext): void {
  const [leftSeatId, rightSeatId] = context.state.seats;
  const players = context.state.players;
  const left = players[leftSeatId];
  const right = players[rightSeatId];
  if (!left || !right) {
    throw new Error("终局比较缺少玩家");
  }
  if (left.influence > right.influence) {
    finishMatch(context.state, left.seatId, false, "round_limit", context.emit);
    return;
  }
  if (right.influence > left.influence) {
    finishMatch(context.state, right.seatId, false, "round_limit", context.emit);
    return;
  }
  finishMatch(context.state, null, true, "round_limit", context.emit);
}

/** 结束当前回合，推进到下一位玩家或下一轮。 */
export function endTurn(context: TurnContext): void {
  const seatId = context.state.activeSeatId;
  if (seatId === null) {
    throw new Error("当前没有可结束的回合");
  }
  const player = context.state.players[seatId];
  if (!player) {
    throw new Error(`当前玩家不存在：${seatId}`);
  }
  endActivePlayerStatuses(context, player);
  assertHandLimits(context.content, player);
  player.organizationDeploysThisTurn = 0;
  player.assetDeploysThisTurn = 0;
  player.benchmarksThisTurn = 0;
  player.techChecksThisTurn = 0;
  context.emit({
    type: "turn_ended",
    payload: { seatId, round: context.state.round },
  });
  if (context.state.phase === "finished") {
    return;
  }

  if (context.state.turnOrderIndex === 0) {
    context.state.turnOrderIndex = 1;
    startTurn(context);
    return;
  }

  if (context.state.round >= context.content.balance.roundLimit) {
    finishByComparison(context);
    return;
  }
  startRound(context);
  startTurn(context);
}

/** 调度完成后进入第一轮。 */
export function startPlaying(context: TurnContext): void {
  const [secondSeatId] = [context.state.seats[1]];
  const second = context.state.players[secondSeatId];
  if (!second) {
    throw new Error("后手玩家不存在");
  }
  context.state.phase = "playing";
  context.emit({
    type: "match_started",
    payload: { firstSeatId: context.state.firstSeatId },
  });
  for (let count = 0; count < context.content.balance.openingActionHandSecond; count += 1) {
    drawAction(context.content, context.state, second, context.randomInt, context.emit);
  }
  for (const player of Object.values(context.state.players)) {
    initializeBlueprintPity(context.content, context.state, player);
  }
  startRound(context);
  startTurn(context);
}

/** 供命令层调用时使用的效果列表类型导出。 */
export type TurnEffect = Effect;
