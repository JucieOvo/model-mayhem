/**
 * Benchmark 结算。
 *
 * 作者：JucieOvo
 *
 * 主动模型由命令指定，防守方从所有合格模型中选择公开得分最高者。模型不会因
 * Benchmark 失去传统生命值，只会获得承压状态，并由影响力支付胜负代价。
 */

import type { Ability, ContentPack } from "@modelmayhem/model-mayhem-content";
import { getModelScore, getOpenBenchmarkThreshold } from "./modifiers";
import type { EmitEvent } from "./mutations";
import { consumeStatus, gainInfluence, grantModelStatus, stealInfluence } from "./mutations";
import { requireAsset } from "./selectors";
import type { BenchmarkResult, MatchState } from "./types";

/** 判断一个模型能否参加当前轮次的指定 Benchmark。 */
export function isModelEligible(
  content: ContentPack,
  state: MatchState,
  modelInstanceId: string,
  ability: Ability,
): boolean {
  const asset = state.assets[modelInstanceId];
  if (!asset) {
    return false;
  }
  const card = requireAsset(content, asset.cardId);
  if (card.assetKind !== "model" || card.abilities[ability] <= 0) {
    return false;
  }
  if (asset.lastParticipatedRound === state.round) {
    return false;
  }
  const anchor = state.anchors[asset.anchorId];
  if (!anchor || anchor.statuses.some((status) => status.id === "outage" && !status.pending)) {
    return false;
  }
  if (
    asset.statuses.some(
      (status) =>
        (status.id === "pressure" && !status.pending) ||
        (status.id === "training" && status.pending),
    )
  ) {
    return false;
  }
  return true;
}

/** 从玩家场上寻找当前能力得分最高的合格模型。 */
export function findBestModel(
  content: ContentPack,
  state: MatchState,
  seatId: string,
  ability: Ability,
): string | null {
  let bestModelId: string | null = null;
  let bestScore = -1;
  for (const asset of Object.values(state.assets)) {
    if (
      asset.ownerSeatId !== seatId ||
      !isModelEligible(content, state, asset.instanceId, ability)
    ) {
      continue;
    }
    const score = getModelScore(content, state, seatId, asset.instanceId, ability).final;
    if (score > bestScore) {
      bestModelId = asset.instanceId;
      bestScore = score;
    }
  }
  return bestModelId;
}

function consumeBenchmarkStatuses(
  state: MatchState,
  modelInstanceId: string,
  emit: EmitEvent,
): void {
  const asset = state.assets[modelInstanceId];
  if (!asset) {
    return;
  }
  consumeStatus(asset.statuses, modelInstanceId, "heat", emit);
  consumeStatus(asset.statuses, modelInstanceId, "training", emit);
}

function applyDefeatPressure(
  content: ContentPack,
  state: MatchState,
  modelInstanceId: string,
  durationTurns: number,
  emit: EmitEvent,
): void {
  const asset = state.assets[modelInstanceId];
  if (!asset) {
    throw new Error(`承压目标模型不存在：${modelInstanceId}`);
  }
  grantModelStatus(content, state, asset, "pressure", "benchmark", durationTurns, emit);
}

function pressureTurnsForMargin(content: ContentPack, scoreDifference: number): number {
  return scoreDifference >= content.balance.benchmark.heavyDefeatMargin
    ? content.balance.benchmark.heavyDefeatPressureTurns
    : content.balance.benchmark.defeatPressureTurns;
}

/**
 * 结算一次 Benchmark，并返回可公开回放的结构化结果。
 */
export function resolveBenchmark(
  content: ContentPack,
  state: MatchState,
  challengerSeatId: string,
  challengerModelInstanceId: string,
  ability: Ability,
  benchmarkType: "standard" | "competitive" | "headline",
  emit: EmitEvent,
): BenchmarkResult {
  const challengerPlayer = state.players[challengerSeatId];
  if (!challengerPlayer) {
    throw new Error(`Benchmark 发起者不存在：${challengerSeatId}`);
  }
  if (!isModelEligible(content, state, challengerModelInstanceId, ability)) {
    throw new Error(`模型不具备参赛资格：${challengerModelInstanceId}`);
  }
  const defenderSeatId = state.seats.find((seatId) => seatId !== challengerSeatId);
  if (!defenderSeatId) {
    throw new Error("Benchmark 缺少防守玩家");
  }
  const defenderPlayer = state.players[defenderSeatId];
  if (!defenderPlayer) {
    throw new Error(`防守玩家不存在：${defenderSeatId}`);
  }
  const assignedDefenderModelInstanceId = defenderPlayer.benchmarkDefenderModelInstanceId ?? null;
  const assignedDefenderIsEligible =
    assignedDefenderModelInstanceId !== null &&
    isModelEligible(content, state, assignedDefenderModelInstanceId, ability);
  const defenderModelInstanceId = assignedDefenderIsEligible
    ? assignedDefenderModelInstanceId
    : findBestModel(content, state, defenderSeatId, ability);
  const defenderSelection =
    defenderModelInstanceId === null
      ? "none"
      : assignedDefenderIsEligible
        ? "assigned"
        : "automatic";
  const threshold = getOpenBenchmarkThreshold(content, state.round);
  const challengerScoreDetails = getModelScore(
    content,
    state,
    challengerSeatId,
    challengerModelInstanceId,
    ability,
  );
  const challengerScore = challengerScoreDetails.final;
  const defenderScoreDetails =
    defenderModelInstanceId === null
      ? null
      : getModelScore(content, state, defenderSeatId, defenderModelInstanceId, ability);
  const defenderScore = defenderScoreDetails?.final ?? null;
  const scoreDifference = defenderScore === null ? null : Math.abs(challengerScore - defenderScore);

  const challenger = state.assets[challengerModelInstanceId];
  if (!challenger) {
    throw new Error(`主动模型不存在：${challengerModelInstanceId}`);
  }
  challenger.lastParticipatedRound = state.round;
  challengerPlayer.benchmarksThisTurn += 1;
  challengerPlayer.highestBenchmarkScore = Math.max(
    challengerPlayer.highestBenchmarkScore,
    challengerScore,
  );
  consumeBenchmarkStatuses(state, challengerModelInstanceId, emit);

  if (defenderModelInstanceId !== null) {
    const defender = state.assets[defenderModelInstanceId];
    const defenderPlayer = state.players[defenderSeatId];
    if (!defender || !defenderPlayer) {
      throw new Error("防守模型或防守玩家不存在");
    }
    defender.lastParticipatedRound = state.round;
    defenderPlayer.highestBenchmarkScore = Math.max(
      defenderPlayer.highestBenchmarkScore,
      defenderScore ?? 0,
    );
    consumeBenchmarkStatuses(state, defenderModelInstanceId, emit);
  }

  let winnerSeatId: string | null = null;
  let tied = false;
  let pressureTurnsApplied: number | null = null;
  if (defenderScore === null) {
    if (challengerScore >= threshold) {
      winnerSeatId = challengerSeatId;
      challengerPlayer.benchmarkWins += 1;
      gainInfluence(
        content,
        state,
        challengerSeatId,
        content.balance.benchmark.standardGain,
        "benchmark_open",
        emit,
      );
    }
  } else if (challengerScore > defenderScore) {
    if (defenderModelInstanceId === null) {
      throw new Error("防守分数存在时缺少防守模型");
    }
    winnerSeatId = challengerSeatId;
    challengerPlayer.benchmarkWins += 1;
    const amount =
      benchmarkType === "competitive"
        ? content.balance.benchmark.competitiveGain
        : benchmarkType === "headline"
          ? content.balance.benchmark.headlineGain
          : content.balance.benchmark.standardGain;
    gainInfluence(content, state, challengerSeatId, amount, "benchmark_win", emit);
    if (benchmarkType === "headline") {
      stealInfluence(
        content,
        state,
        challengerSeatId,
        defenderSeatId,
        content.balance.benchmark.headlineSteal,
        emit,
      );
    }
    if (scoreDifference === null) {
      throw new Error("存在防守模型时缺少分差");
    }
    pressureTurnsApplied = pressureTurnsForMargin(content, scoreDifference);
    applyDefeatPressure(content, state, defenderModelInstanceId, pressureTurnsApplied, emit);
  } else if (challengerScore < defenderScore) {
    winnerSeatId = defenderSeatId;
    defenderPlayer.benchmarkWins += 1;
    const amount =
      benchmarkType === "competitive"
        ? content.balance.benchmark.competitiveGain
        : benchmarkType === "headline"
          ? content.balance.benchmark.headlineGain
          : content.balance.benchmark.standardGain;
    gainInfluence(content, state, defenderSeatId, amount, "benchmark_win", emit);
    if (benchmarkType === "headline") {
      stealInfluence(
        content,
        state,
        defenderSeatId,
        challengerSeatId,
        content.balance.benchmark.headlineSteal,
        emit,
      );
    }
    if (scoreDifference === null) {
      throw new Error("存在防守模型时缺少分差");
    }
    pressureTurnsApplied = pressureTurnsForMargin(content, scoreDifference);
    applyDefeatPressure(content, state, challengerModelInstanceId, pressureTurnsApplied, emit);
  } else {
    if (defenderModelInstanceId === null) {
      throw new Error("平局时缺少防守模型");
    }
    tied = true;
    pressureTurnsApplied = content.balance.benchmark.defeatPressureTurns;
    applyDefeatPressure(content, state, challengerModelInstanceId, pressureTurnsApplied, emit);
    applyDefeatPressure(content, state, defenderModelInstanceId, pressureTurnsApplied, emit);
  }

  const result: BenchmarkResult = {
    type: benchmarkType,
    ability,
    challengerSeatId,
    challengerModelInstanceId,
    challengerBase: challengerScoreDetails.base,
    challengerModifiers: challengerScoreDetails.adjustments,
    challengerScore,
    defenderSeatId,
    defenderModelInstanceId,
    defenderSelection,
    defenderBase: defenderScoreDetails?.base ?? null,
    defenderModifiers: defenderScoreDetails?.adjustments ?? [],
    defenderScore,
    scoreDifference,
    threshold,
    pressureTurnsApplied,
    winnerSeatId,
    tied,
  };
  state.lastBenchmark = result;
  emit({
    type: "benchmark_resolved",
    payload: result,
  });
  return result;
}
