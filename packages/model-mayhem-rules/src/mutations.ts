/**
 * 对局状态的最小修改原语。
 *
 * 作者：JucieOvo
 *
 * 该模块集中实现影响力、状态和胜负检查，避免 Benchmark、行动和世界事件各自
 * 修改相同字段而产生规则分叉。
 */

import type { DomainEvent } from "@modelmayhem/game-kernel";
import type { ContentPack, StatusId } from "@modelmayhem/model-mayhem-content";
import type {
  AnchorState,
  AssetState,
  MatchState,
  ModelMayhemEventPayload,
  ModelMayhemEventType,
  StatusState,
} from "./types";

export type EmitEvent = (event: DomainEvent<ModelMayhemEventType, ModelMayhemEventPayload>) => void;

const NEGATIVE_STATUSES = new Set<StatusId>([
  "controversy",
  "outage",
  "overload",
  "regulation",
  "training",
  "pressure",
]);

function refreshOrAddStatus(
  statuses: StatusState[],
  statusId: StatusId,
  sourceId: string,
  durationTurns: number,
  pending: boolean,
): void {
  const existing = statuses.find((status) => status.id === statusId);
  if (existing) {
    existing.remainingTurns = Math.max(existing.remainingTurns, durationTurns);
    existing.pending = existing.pending && pending;
    return;
  }
  statuses.push({
    id: statusId,
    sourceId,
    remainingTurns: Math.max(0, durationTurns),
    pending,
  });
}

function consumeFortify(targetId: string, statuses: StatusState[], emit: EmitEvent): boolean {
  const index = statuses.findIndex((status) => status.id === "fortify");
  if (index < 0) {
    return false;
  }
  statuses.splice(index, 1);
  emit({
    type: "status_removed",
    payload: { targetId, status: "fortify", reason: "consumed" },
  });
  return true;
}

/** 给玩家施加状态。 */
export function grantPlayerStatus(
  state: MatchState,
  seatId: string,
  statusId: StatusId,
  sourceId: string,
  durationTurns: number,
  emit: EmitEvent,
): void {
  const player = state.players[seatId];
  if (!player) {
    throw new Error(`玩家不存在：${seatId}`);
  }
  if (NEGATIVE_STATUSES.has(statusId) && consumeFortify(seatId, player.statuses, emit)) {
    return;
  }
  refreshOrAddStatus(
    player.statuses,
    statusId,
    sourceId,
    durationTurns,
    state.activeSeatId === seatId,
  );
  emit({
    type: "status_granted",
    payload: { targetId: seatId, status: statusId },
  });
}

/** 给据点施加状态。 */
export function grantAnchorStatus(
  content: ContentPack,
  state: MatchState,
  anchor: AnchorState,
  statusId: StatusId,
  sourceId: string,
  durationTurns: number,
  replacementId: StatusId | undefined,
  emit: EmitEvent,
): void {
  if (NEGATIVE_STATUSES.has(statusId) && consumeFortify(anchor.id, anchor.statuses, emit)) {
    return;
  }
  if (
    !anchor.statuses.some((status) => status.id === statusId) &&
    anchor.statuses.length >= content.balance.statusLimitPerAnchor
  ) {
    const replacementIndex =
      replacementId === undefined
        ? 0
        : anchor.statuses.findIndex((status) => status.id === replacementId);
    if (replacementIndex < 0) {
      throw new Error(`据点 ${anchor.id} 的状态替换目标无效：${String(replacementId)}`);
    }
    const removed = anchor.statuses.splice(replacementIndex, 1)[0];
    if (removed) {
      emit({
        type: "status_removed",
        payload: { targetId: anchor.id, status: removed.id, reason: "replaced" },
      });
    }
  }
  refreshOrAddStatus(
    anchor.statuses,
    statusId,
    sourceId,
    durationTurns,
    state.activeSeatId === anchor.ownerSeatId,
  );
  emit({
    type: "status_granted",
    payload: { targetId: anchor.id, status: statusId },
  });
}

/** 给模型施加状态。模型只保留一个状态。 */
export function grantModelStatus(
  content: ContentPack,
  state: MatchState,
  asset: AssetState,
  statusId: StatusId,
  sourceId: string,
  durationTurns: number,
  emit: EmitEvent,
): void {
  if (NEGATIVE_STATUSES.has(statusId) && consumeFortify(asset.instanceId, asset.statuses, emit)) {
    return;
  }
  if (
    !asset.statuses.some((status) => status.id === statusId) &&
    asset.statuses.length >= content.balance.statusLimitPerModel
  ) {
    const removed = asset.statuses.shift();
    if (removed) {
      emit({
        type: "status_removed",
        payload: {
          targetId: asset.instanceId,
          status: removed.id,
          reason: "replaced",
        },
      });
    }
  }
  refreshOrAddStatus(
    asset.statuses,
    statusId,
    sourceId,
    durationTurns,
    state.activeSeatId === asset.ownerSeatId,
  );
  emit({
    type: "status_granted",
    payload: { targetId: asset.instanceId, status: statusId },
  });
}

/** 从玩家、据点或模型中移除指定状态。 */
export function removeStatuses(
  statuses: StatusState[],
  targetId: string,
  statusId: StatusId,
  maxCount: number,
  emit: EmitEvent,
): void {
  let removed = 0;
  for (let index = statuses.length - 1; index >= 0 && removed < maxCount; index -= 1) {
    if (statuses[index]?.id !== statusId) {
      continue;
    }
    statuses.splice(index, 1);
    removed += 1;
    emit({
      type: "status_removed",
      payload: { targetId, status: statusId, reason: "effect" },
    });
  }
}

/** 消耗一个状态，用于热度、训练、势头和过载。 */
export function consumeStatus(
  statuses: StatusState[],
  targetId: string,
  statusId: StatusId,
  emit: EmitEvent,
): void {
  removeStatuses(statuses, targetId, statusId, 1, emit);
}

/** 给玩家增加影响力，并遵守单轮上限。 */
export function gainInfluence(
  content: ContentPack,
  state: MatchState,
  seatId: string,
  amount: number,
  sourceCardId: string,
  emit: EmitEvent,
): number {
  const player = state.players[seatId];
  if (!player) {
    throw new Error(`玩家不存在：${seatId}`);
  }
  const remaining = Math.max(
    0,
    content.balance.influenceGainPerRoundLimit - player.influenceGainedThisRound,
  );
  const gained = Math.min(Math.max(0, amount), remaining);
  if (gained <= 0) {
    return 0;
  }
  player.influence = Math.min(content.balance.influenceTarget, player.influence + gained);
  player.influenceGainedThisRound += gained;
  emit({
    type: "influence_gained",
    payload: {
      seatId,
      amount: gained,
      sourceCardId,
      total: player.influence,
    },
  });
  checkInfluenceWin(content, state, seatId, emit);
  return gained;
}

/** 在胜者拥有完整夺取空间时，才把对手影响力转移给胜者。 */
export function stealInfluence(
  content: ContentPack,
  state: MatchState,
  winnerSeatId: string,
  loserSeatId: string,
  amount: number,
  emit: EmitEvent,
): number {
  const winner = state.players[winnerSeatId];
  const loser = state.players[loserSeatId];
  if (!winner || !loser) {
    throw new Error("夺取影响力时缺少玩家");
  }
  const winnerRoom = content.balance.influenceGainPerRoundLimit - winner.influenceGainedThisRound;
  if (winnerRoom < amount || loser.influence < amount) {
    return 0;
  }
  loser.influence -= amount;
  winner.influence = Math.min(content.balance.influenceTarget, winner.influence + amount);
  winner.influenceGainedThisRound += amount;
  emit({
    type: "influence_stolen",
    payload: {
      winnerSeatId,
      loserSeatId,
      amount,
      winnerTotal: winner.influence,
      loserTotal: loser.influence,
    },
  });
  checkInfluenceWin(content, state, winnerSeatId, emit);
  return amount;
}

/** 资源修改统一保持非负，并遵守资本上限。 */
export function modifyResources(
  content: ContentPack,
  state: MatchState,
  seatId: string,
  resource: "compute" | "capital",
  amount: number,
): void {
  const player = state.players[seatId];
  if (!player) {
    throw new Error(`玩家不存在：${seatId}`);
  }
  if (resource === "compute") {
    player.compute = Math.max(0, player.compute + amount);
    return;
  }
  player.capital = Math.min(content.balance.capitalLimit, Math.max(0, player.capital + amount));
}

/** 当前影响力达到目标后立即结束对局。 */
export function checkInfluenceWin(
  content: ContentPack,
  state: MatchState,
  seatId: string,
  emit: EmitEvent,
): void {
  const player = state.players[seatId];
  if (!player || player.influence < content.balance.influenceTarget) {
    return;
  }
  finishMatch(state, seatId, false, "influence_target", emit);
}

/** 设置终局状态并发送唯一终局事件。 */
export function finishMatch(
  state: MatchState,
  winnerSeatId: string | null,
  isDraw: boolean,
  reason: Exclude<MatchState["finishReason"], null>,
  emit: EmitEvent,
): void {
  if (state.phase === "finished") {
    return;
  }
  state.phase = "finished";
  state.activeSeatId = null;
  state.pendingTechCheck = null;
  state.winnerSeatId = winnerSeatId;
  state.isDraw = isDraw;
  state.finishReason = reason;
  emit({
    type: "match_finished",
    payload: { winnerSeatId, isDraw, reason },
  });
}
