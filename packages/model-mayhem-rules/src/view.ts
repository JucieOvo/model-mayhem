/**
 * 对局状态视图投影。
 *
 * 作者：JucieOvo
 *
 * 投影器按座位隐藏蓝图手牌、行动手牌和对手未知信息，并隐藏技术检定正确答案。
 * 公开视图包含状态、容量和费用所需的全部可见数据。
 */

import type { CommandActor } from "@modelmayhem/game-kernel";
import type { ContentPack } from "@modelmayhem/model-mayhem-content";
import { getCapitalIncome, getComputeCeiling } from "./modifiers";
import { getActionPoolComposition } from "./pool";
import type {
  AnchorView,
  AssetView,
  MatchState,
  ModelMayhemView,
  PlayerState,
  PrivatePlayerView,
  PublicPlayerView,
} from "./types";
import { getAnchorCapacity } from "./view-helpers";

function anchorView(content: ContentPack, state: MatchState, anchorId: string): AnchorView {
  const anchor = state.anchors[anchorId];
  if (!anchor) {
    throw new Error(`据点不存在：${anchorId}`);
  }
  return {
    id: anchor.id,
    ownerSeatId: anchor.ownerSeatId,
    organizationCardId: anchor.organizationCardId,
    isHomeLab: anchor.isHomeLab,
    slotIndex: anchor.slotIndex,
    capacity: getAnchorCapacity(content, state, anchor.id).final,
    statuses: anchor.statuses.map((status) => ({ ...status })),
    assetInstanceIds: [...anchor.assetInstanceIds],
  };
}

function assetView(state: MatchState, instanceId: string): AssetView {
  const asset = state.assets[instanceId];
  if (!asset) {
    throw new Error(`资产不存在：${instanceId}`);
  }
  return {
    instanceId: asset.instanceId,
    cardId: asset.cardId,
    ownerSeatId: asset.ownerSeatId,
    anchorId: asset.anchorId,
    ...(asset.attachedModelInstanceId
      ? { attachedModelInstanceId: asset.attachedModelInstanceId }
      : {}),
    statuses: asset.statuses.map((status) => ({ ...status })),
    lastParticipatedRound: asset.lastParticipatedRound,
  };
}

function publicPlayerView(
  content: ContentPack,
  state: MatchState,
  seatId: string,
): PublicPlayerView {
  const player = state.players[seatId];
  if (!player) {
    throw new Error(`玩家不存在：${seatId}`);
  }
  const anchors = Object.values(state.anchors)
    .filter((anchor) => anchor.ownerSeatId === seatId)
    .map((anchor) => anchorView(content, state, anchor.id));
  const assets = Object.values(state.assets)
    .filter((asset) => asset.ownerSeatId === seatId)
    .map((asset) => assetView(state, asset.instanceId));
  return {
    seatId: player.seatId,
    displayName: player.displayName,
    faction: player.faction,
    doctrineId: player.doctrineId,
    influence: player.influence,
    capital: player.capital,
    compute: player.compute,
    blueprintHandCount: player.blueprintHand.length,
    blueprintHandOverflow: Math.max(
      0,
      player.blueprintHand.length - content.balance.blueprintHandLimit,
    ),
    actionHandCount: player.actionHand.length,
    actionHandOverflow: Math.max(0, player.actionHand.length - content.balance.actionHandLimit),
    blueprintDeckCount: player.blueprintDeck.length,
    anchors,
    assets,
    benchmarkWins: player.benchmarkWins,
    highestBenchmarkScore: player.highestBenchmarkScore,
    factionLock: player.factionLock,
    mulliganReady: player.mulliganReady,
    turnNumber: player.turnNumber,
    influenceGainedThisRound: player.influenceGainedThisRound,
    influenceGainRemaining: Math.max(
      0,
      content.balance.influenceGainPerRoundLimit - player.influenceGainedThisRound,
    ),
    organizationDeploysThisTurn: player.organizationDeploysThisTurn,
    assetDeploysThisTurn: player.assetDeploysThisTurn,
    benchmarksThisTurn: player.benchmarksThisTurn,
    techChecksThisTurn: player.techChecksThisTurn,
    benchmarkDefenderModelInstanceId: player.benchmarkDefenderModelInstanceId ?? null,
    capitalIncome: getCapitalIncome(content, state, seatId),
    nextComputeCeiling: getComputeCeiling(content, state, seatId, player.turnNumber + 1),
    timedModifiers: player.timedModifiers.map((modifier) => ({
      ...modifier,
      effect: structuredClone(modifier.effect),
    })),
  };
}

function blueprintDeckComposition(
  state: MatchState,
  player: PlayerState,
): readonly {
  readonly cardId: string;
  readonly count: number;
}[] {
  const counts = new Map<string, number>();
  for (const instanceId of [
    ...(player.blueprintDeck ?? []),
    ...(player.blueprintHand ?? []),
    ...(player.blueprintArchive ?? []),
  ]) {
    const cardId = state.cardInstances[instanceId]?.cardId;
    if (!cardId) {
      throw new Error(`蓝图牌堆缺少卡牌实例：${instanceId}`);
    }
    counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([cardId, count]) => ({ cardId, count }))
    .sort((left, right) => left.cardId.localeCompare(right.cardId));
}

function privatePlayerView(
  content: ContentPack,
  state: MatchState,
  seatId: string,
): PrivatePlayerView {
  const player = state.players[seatId];
  if (!player) {
    throw new Error(`玩家不存在：${seatId}`);
  }
  return {
    ...publicPlayerView(content, state, seatId),
    blueprintDeckComposition: blueprintDeckComposition(state, player),
    blueprintHand: player.blueprintHand.map((instanceId) => {
      const instance = state.cardInstances[instanceId];
      if (!instance) {
        throw new Error(`蓝图手牌缺少卡牌实例：${instanceId}`);
      }
      return {
        instanceId,
        cardId: instance.cardId,
      };
    }),
    actionHand: player.actionHand.map((action) => ({ ...action })),
  };
}

/** 生成指定座位可见的状态。 */
export function projectModelMayhemView(
  content: ContentPack,
  state: MatchState,
  viewer: CommandActor,
): ModelMayhemView {
  const opponentSeatId = state.seats.find((seatId) => seatId !== viewer.seatId);
  if (!opponentSeatId || !state.players[viewer.seatId]) {
    throw new Error(`视图座位不属于本局：${viewer.seatId}`);
  }
  return {
    gameId: state.gameId,
    viewerSeatId: viewer.seatId,
    phase: state.phase,
    round: state.round,
    activeSeatId: state.activeSeatId,
    firstSeatId: state.firstSeatId,
    winnerSeatId: state.winnerSeatId,
    isDraw: state.isDraw,
    finishReason: state.finishReason,
    me: privatePlayerView(content, state, viewer.seatId),
    opponent: publicPlayerView(content, state, opponentSeatId),
    worldEvent:
      state.worldEvent === null
        ? null
        : {
            cardId: state.worldEvent.cardId,
            startedAtRound: state.worldEvent.startedAtRound,
            expiresAfterRound: state.worldEvent.expiresAfterRound,
          },
    pendingTechCheck:
      state.pendingTechCheck === null
        ? null
        : {
            actionInstanceId: state.pendingTechCheck.actionInstanceId,
            actionCardId: state.pendingTechCheck.actionCardId,
            casterSeatId: state.pendingTechCheck.casterSeatId,
            ...(state.pendingTechCheck.targetAnchorId
              ? { targetAnchorId: state.pendingTechCheck.targetAnchorId }
              : {}),
            ...(state.pendingTechCheck.targetModelInstanceId
              ? {
                  targetModelInstanceId: state.pendingTechCheck.targetModelInstanceId,
                }
              : {}),
            ...(state.pendingTechCheck.benchmarkModelInstanceId
              ? {
                  benchmarkModelInstanceId: state.pendingTechCheck.benchmarkModelInstanceId,
                }
              : {}),
            ...(state.pendingTechCheck.statusReplacementId
              ? {
                  statusReplacementId: state.pendingTechCheck.statusReplacementId,
                }
              : {}),
          },
    lastBenchmark: state.lastBenchmark ? structuredClone(state.lastBenchmark) : null,
    actionPoolComposition: getActionPoolComposition(content, state, viewer.seatId),
  };
}
