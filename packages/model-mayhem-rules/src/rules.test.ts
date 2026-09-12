/**
 * Model Mayhem 规则核心真实流程测试。
 *
 * 作者：JucieOvo
 *
 * 测试使用真实 YAML 内容、固定随机种子和公开命令入口，不调用网络或大模型。
 */

import type { CommandActor } from "@modelmayhem/game-kernel";
import { GameRuntime } from "@modelmayhem/game-kernel";
import { loadContentPack } from "@modelmayhem/model-mayhem-content";
import { describe, expect, it } from "vitest";
import { createModelMayhemDefinition } from "./engine";
import { generateLegalActions } from "./legal-actions";
import { buildActionPool, drawBlueprint } from "./pool";
import type {
  LegalAction,
  MatchState,
  ModelMayhemCommand,
  ModelMayhemDefinitionOptions,
} from "./types";

const content = loadContentPack();
const seats = [
  { seatId: "player", displayName: "玩家", deckId: "open_diffusion_starter" },
  { seatId: "agent", displayName: "陪练 Agent", deckId: "frontier_scaling_starter" },
] as const;
const options: ModelMayhemDefinitionOptions = { content, seats };
const playerActor: CommandActor = { seatId: "player", kind: "human" };
const agentActor: CommandActor = { seatId: "agent", kind: "agent" };

function createRuntime(seed = 9) {
  const definition = createModelMayhemDefinition(options);
  return GameRuntime.create(definition, {
    gameId: "test-match",
    seed,
    seats: seats.map((seat) => ({ id: seat.seatId, displayName: seat.displayName })),
  });
}

function startMatch(seed = 9) {
  const runtime = createRuntime(seed);
  const first = runtime.dispatch({
    commandId: "mulligan-player",
    actor: playerActor,
    command: { kind: "mulligan", cardInstanceIds: [] },
  });
  const second = runtime.dispatch({
    commandId: "mulligan-agent",
    actor: agentActor,
    command: { kind: "mulligan", cardInstanceIds: [] },
  });
  if (!first.accepted || !second.accepted) {
    throw new Error("调度命令应被接受");
  }
  while (
    playerState(runtime.snapshot().game, "player").blueprintHand.length >
    content.balance.blueprintHandLimit
  ) {
    const cardInstanceId = playerState(runtime.snapshot().game, "player").blueprintHand[0];
    if (!cardInstanceId) {
      throw new Error("测试缺少待弃置蓝图");
    }
    const result = runtime.dispatch({
      commandId: `discard-blueprint-${cardInstanceId}`,
      actor: playerActor,
      command: {
        kind: "discard_blueprint",
        cardInstanceId,
      },
    });
    if (!result.accepted) {
      throw new Error(`测试蓝图弃置命令应被接受：${result.violation.message}`);
    }
  }
  while (
    playerState(runtime.snapshot().game, "player").actionHand.length >
    content.balance.actionHandLimit
  ) {
    const action = playerState(runtime.snapshot().game, "player").actionHand[0];
    if (!action) {
      throw new Error("测试缺少待弃置行动");
    }
    const result = runtime.dispatch({
      commandId: `discard-${action.id}`,
      actor: playerActor,
      command: {
        kind: "discard_action",
        actionInstanceId: action.id,
      },
    });
    if (!result.accepted) {
      throw new Error(`测试弃置命令应被接受：${result.violation.message}`);
    }
  }
  return runtime;
}

type MatchRuntime = ReturnType<typeof startMatch>;

function legalActions(state: MatchState, actor: CommandActor): readonly LegalAction[] {
  return generateLegalActions(options, state, actor);
}

function playerState(state: MatchState, seatId: string) {
  const player = state.players[seatId];
  if (!player) {
    throw new Error(`测试状态缺少玩家：${seatId}`);
  }
  return player;
}

function addModelToSnapshot(
  state: MatchState,
  seatId: string,
  instanceId: string,
  cardId: string,
): void {
  const anchor = Object.values(state.anchors).find((candidate) => candidate.ownerSeatId === seatId);
  const card = content.assets.get(cardId);
  if (!anchor || card?.assetKind !== "model") {
    throw new Error(`测试无法把 ${cardId} 放入 ${seatId} 的场面`);
  }
  state.assets[instanceId] = {
    instanceId,
    cardId,
    ownerSeatId: seatId,
    anchorId: anchor.id,
    statuses: [],
    lastParticipatedRound: null,
  };
  anchor.assetInstanceIds.push(instanceId);
}

function giveBlueprintCardToHand(state: MatchState, seatId: string, cardId: string): void {
  const player = playerState(state, seatId);
  if (
    player.blueprintHand.some((instanceId) => state.cardInstances[instanceId]?.cardId === cardId)
  ) {
    return;
  }
  const source = [player.blueprintDeck, player.blueprintArchive];
  for (const cards of source) {
    const index = cards.findIndex(
      (instanceId) => state.cardInstances[instanceId]?.cardId === cardId,
    );
    if (index < 0) {
      continue;
    }
    const [instanceId] = cards.splice(index, 1);
    if (instanceId) {
      player.blueprintHand.push(instanceId);
      return;
    }
  }
  throw new Error(`测试牌组缺少可放入手牌的卡：${cardId}`);
}

function prepareBenchmark(
  assignedDefenderModelInstanceId: string | null,
  defenderCardId = "small_efficient",
) {
  const runtime = startMatch(9);
  const snapshot = runtime.snapshot();
  const player = playerState(snapshot.game, "player");
  const opponent = playerState(snapshot.game, "agent");
  addModelToSnapshot(snapshot.game, "player", "challenger-model", "frontier_reasoning");
  addModelToSnapshot(snapshot.game, "agent", "defender-model", defenderCardId);
  player.compute = 9;
  player.actionHand.push({
    id: "test-standard-benchmark",
    cardId: "standard_benchmark",
  });
  opponent.benchmarkDefenderModelInstanceId = assignedDefenderModelInstanceId;
  const prepared = GameRuntime.restore(createModelMayhemDefinition(options), snapshot);
  const benchmarkAction = legalActions(prepared.snapshot().game, playerActor).find(
    (action) =>
      action.kind === "play_action" &&
      action.actionInstanceId === "test-standard-benchmark" &&
      action.benchmarkModelInstanceId === "challenger-model",
  );
  if (!benchmarkAction) {
    throw new Error("测试需要合法 Benchmark 行动");
  }
  return { prepared, benchmarkAction };
}

function commandFromLegal(action: LegalAction): ModelMayhemCommand {
  switch (action.kind) {
    case "mulligan":
      return { kind: "mulligan", cardInstanceIds: action.cardInstanceIds };
    case "deploy_organization":
      return {
        kind: "deploy_organization",
        cardInstanceId: action.cardInstanceId,
        slotIndex: action.slotIndex,
      };
    case "deploy_asset":
      return {
        kind: "deploy_asset",
        cardInstanceId: action.cardInstanceId,
        anchorId: action.anchorId,
        ...(action.attachedModelInstanceId
          ? { attachedModelInstanceId: action.attachedModelInstanceId }
          : {}),
      };
    case "play_action":
      return {
        kind: "play_action",
        actionInstanceId: action.actionInstanceId,
        ...(action.targetAnchorId ? { targetAnchorId: action.targetAnchorId } : {}),
        ...(action.targetModelInstanceId
          ? { targetModelInstanceId: action.targetModelInstanceId }
          : {}),
        ...(action.benchmarkModelInstanceId
          ? { benchmarkModelInstanceId: action.benchmarkModelInstanceId }
          : {}),
        ...(action.statusReplacementId ? { statusReplacementId: action.statusReplacementId } : {}),
      };
    case "discard_action":
      return {
        kind: "discard_action",
        actionInstanceId: action.actionInstanceId,
      };
    case "discard_blueprint":
      return {
        kind: "discard_blueprint",
        cardInstanceId: action.cardInstanceId,
      };
    case "set_benchmark_defender":
      return {
        kind: "set_benchmark_defender",
        modelInstanceId: action.modelInstanceId,
      };
    case "resolve_tech_check":
      return { kind: "resolve_tech_check", optionId: action.optionId };
    case "end_turn":
      return { kind: "end_turn" };
    case "surrender":
      return { kind: "surrender" };
  }
}

function prepareAction(
  cardId: string,
  mutate?: (snapshot: ReturnType<MatchRuntime["snapshot"]>) => void,
) {
  const runtime = startMatch(9);
  const snapshot = runtime.snapshot();
  const player = playerState(snapshot.game, "player");
  player.compute = 9;
  player.actionHand.push({
    id: `test-${cardId}`,
    cardId,
  });
  mutate?.(snapshot);
  return {
    runtime: GameRuntime.restore(createModelMayhemDefinition(options), snapshot),
    actionInstanceId: `test-${cardId}`,
  };
}

describe("Model Mayhem 标准对局", () => {
  it("双方调度后进入第一轮并恢复算力与资本", () => {
    const runtime = startMatch();
    const state = runtime.snapshot().game;
    expect(state.phase).toBe("playing");
    expect(state.round).toBe(1);
    expect(state.activeSeatId).toBe("player");
    expect(state.players.player?.compute).toBe(3);
    expect(state.players.player?.capital).toBe(5);
    expect(state.players.player?.blueprintHand).toHaveLength(5);
    expect(state.players.agent?.actionHand).toHaveLength(1);
  });

  it("回合开始抽取四张行动牌，可以先用牌，也可以弃置到上限", () => {
    const runtime = createRuntime(9);
    runtime.dispatch({
      commandId: "discard-flow-player-mulligan",
      actor: playerActor,
      command: { kind: "mulligan", cardInstanceIds: [] },
    });
    runtime.dispatch({
      commandId: "discard-flow-agent-mulligan",
      actor: agentActor,
      command: { kind: "mulligan", cardInstanceIds: [] },
    });

    const player = playerState(runtime.snapshot().game, "player");
    expect(player.actionHand).toHaveLength(4);
    expect(player.actionHand.length - content.balance.actionHandLimit).toBe(1);
    expect(
      legalActions(runtime.snapshot().game, playerActor).some(
        (action) => action.kind === "end_turn",
      ),
    ).toBe(false);

    const snapshot = runtime.snapshot();
    const playerStateForTest = playerState(snapshot.game, "player");
    const blueprintOverflow = playerStateForTest.blueprintHand.splice(
      content.balance.blueprintHandLimit,
    );
    playerStateForTest.blueprintArchive.push(...blueprintOverflow);
    playerStateForTest.compute = 9;
    playerStateForTest.actionHand = [
      { id: "flow-price-cut", cardId: "price_cut" },
      { id: "flow-api-release", cardId: "api_release" },
      { id: "flow-report", cardId: "technical_report" },
      { id: "flow-fork", cardId: "community_fork" },
    ];
    const playRuntime = GameRuntime.restore(createModelMayhemDefinition(options), snapshot);
    const playResult = playRuntime.dispatch({
      commandId: "flow-play-action",
      actor: playerActor,
      command: {
        kind: "play_action",
        actionInstanceId: "flow-price-cut",
      },
    });
    if (!playResult.accepted) {
      throw new Error(`使用行动应被接受：${playResult.violation.message}`);
    }
    expect(
      legalActions(playResult.snapshot.game, playerActor).some(
        (action) => action.kind === "end_turn",
      ),
    ).toBe(true);

    const discardRuntime = GameRuntime.restore(createModelMayhemDefinition(options), snapshot);
    const discard = legalActions(discardRuntime.snapshot().game, playerActor).find(
      (action) => action.kind === "discard_action",
    );
    if (!discard) {
      throw new Error("测试需要可用弃置行动");
    }
    const discardResult = discardRuntime.dispatch({
      commandId: "flow-discard-action",
      actor: playerActor,
      command: commandFromLegal(discard),
    });
    if (!discardResult.accepted) {
      throw new Error(`弃置命令应被接受：${discardResult.violation.message}`);
    }
    expect(playerState(discardResult.snapshot.game, "player").actionHand).toHaveLength(3);
    expect(
      legalActions(discardResult.snapshot.game, playerActor).some(
        (action) => action.kind === "end_turn",
      ),
    ).toBe(true);
  });

  it("主要阶段抽牌可以暂时超过上限，结束回合前再处理", () => {
    const runtime = startMatch(9);
    const snapshot = runtime.snapshot();
    const player = playerState(snapshot.game, "player");
    player.compute = 9;
    player.actionHand = [
      { id: "flow-fork", cardId: "community_fork" },
      { id: "flow-api", cardId: "api_release" },
      { id: "flow-report", cardId: "technical_report" },
      { id: "flow-price-cut", cardId: "price_cut" },
    ];
    const prepared = GameRuntime.restore(createModelMayhemDefinition(options), snapshot);
    const play = legalActions(prepared.snapshot().game, playerActor).find(
      (action) => action.kind === "play_action" && action.actionInstanceId === "flow-fork",
    );
    if (!play) {
      throw new Error("测试需要合法社区分支行动");
    }
    const pending = prepared.dispatch({
      commandId: "flow-play-fork",
      actor: playerActor,
      command: commandFromLegal(play),
    });
    expect(pending.accepted).toBe(true);
    const resolve = legalActions(prepared.snapshot().game, playerActor).find(
      (action) => action.kind === "resolve_tech_check" && action.optionId === "a",
    );
    if (!resolve) {
      throw new Error("测试需要正确技术检定选项");
    }
    const resolved = prepared.dispatch({
      commandId: "flow-resolve-fork",
      actor: playerActor,
      command: commandFromLegal(resolve),
    });
    expect(resolved.accepted).toBe(true);
    if (!resolved.accepted) {
      throw new Error(`技术检定应被接受：${resolved.violation.message}`);
    }
    const overflowing = playerState(resolved.snapshot.game, "player");
    expect(overflowing.actionHand).toHaveLength(5);
    expect(
      legalActions(resolved.snapshot.game, playerActor).some(
        (action) => action.kind === "end_turn",
      ),
    ).toBe(false);

    const discard = legalActions(resolved.snapshot.game, playerActor).find(
      (action) => action.kind === "discard_action",
    );
    if (!discard) {
      throw new Error("溢出后应提供弃置行动");
    }
    const firstDiscard = prepared.dispatch({
      commandId: "flow-discard-overflow-1",
      actor: playerActor,
      command: commandFromLegal(discard),
    });
    expect(firstDiscard.accepted).toBe(true);
    const secondDiscard = legalActions(prepared.snapshot().game, playerActor).find(
      (action) => action.kind === "discard_action",
    );
    if (!secondDiscard) {
      throw new Error("溢出后应继续提供弃置行动");
    }
    const secondResult = prepared.dispatch({
      commandId: "flow-discard-overflow-2",
      actor: playerActor,
      command: commandFromLegal(secondDiscard),
    });
    if (!secondResult.accepted) {
      throw new Error(`第二次弃置应被接受：${secondResult.violation.message}`);
    }
    expect(playerState(prepared.snapshot().game, "player").actionHand).toHaveLength(3);
    expect(
      legalActions(prepared.snapshot().game, playerActor).some(
        (action) => action.kind === "end_turn",
      ),
    ).toBe(true);
  });

  it("蓝图连续未出现某类别时触发分类保底", () => {
    const runtime = startMatch(9);
    const snapshot = runtime.snapshot();
    const player = playerState(snapshot.game, "player");
    player.blueprintHand = [];
    const instances = Object.values(snapshot.game.cardInstances)
      .filter((instance) => instance.ownerSeatId === "player")
      .map((instance) => ({
        ...instance,
        card: content.cards.get(instance.cardId),
      }));
    const organization = instances.find((instance) => instance.card?.type === "organization");
    const models = instances.filter(
      (instance) => instance.card?.type === "asset" && instance.card.assetKind === "model",
    );
    const firstModel = models[0];
    const secondModel = models[1];
    if (!organization || !firstModel || !secondModel) {
      throw new Error("测试牌组需要组织与至少两张模型");
    }
    player.blueprintDeck = [firstModel.id, secondModel.id, organization.id];
    player.blueprintPity = {
      organization: content.balance.blueprintPityDraws - 1,
      model: 0,
      knowledge: 0,
    };
    const events: unknown[] = [];
    const drawn = drawBlueprint(
      content,
      snapshot.game,
      player,
      (values) => [...values],
      (event) => events.push(event),
    );
    expect(drawn).toBe(true);
    const drawnInstanceId = player.blueprintHand.at(-1);
    if (!drawnInstanceId) {
      throw new Error("保底抽牌没有进入手牌");
    }
    expect(snapshot.game.cardInstances[drawnInstanceId]?.cardId).toBe(organization.cardId);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "blueprint_pity_triggered",
        payload: expect.objectContaining({
          seatId: "player",
          category: "organization",
        }),
      }),
    );
  });

  it("蓝图超过上限时可以提供弃置行动，并在回合末恢复合法结束状态", () => {
    const runtime = startMatch(9);
    const snapshot = runtime.snapshot();
    const player = playerState(snapshot.game, "player");
    const extraInstanceId = player.blueprintDeck.shift();
    if (!extraInstanceId) {
      throw new Error("测试需要额外蓝图实例");
    }
    player.blueprintHand.push(extraInstanceId);
    const prepared = GameRuntime.restore(createModelMayhemDefinition(options), snapshot);
    expect(
      legalActions(prepared.snapshot().game, playerActor).some(
        (action) => action.kind === "end_turn",
      ),
    ).toBe(false);
    const discard = legalActions(prepared.snapshot().game, playerActor).find(
      (action) => action.kind === "discard_blueprint",
    );
    if (!discard) {
      throw new Error("蓝图溢出时应提供弃置行动");
    }
    const result = prepared.dispatch({
      commandId: "discard-overflow-blueprint",
      actor: playerActor,
      command: commandFromLegal(discard),
    });
    if (!result.accepted) {
      throw new Error(`蓝图弃置应被接受：${result.violation.message}`);
    }
    expect(playerState(prepared.snapshot().game, "player").blueprintHand).toHaveLength(
      content.balance.blueprintHandLimit,
    );
    expect(
      legalActions(prepared.snapshot().game, playerActor).some(
        (action) => action.kind === "end_turn",
      ),
    ).toBe(true);
  });

  it("调度会把选中的起始牌洗回牌堆并补抽相同数量", () => {
    const runtime = createRuntime(9);
    const before = playerState(runtime.snapshot().game, "player");
    const returnedCardInstanceIds = before.blueprintHand.slice(0, 2);
    const result = runtime.dispatch({
      commandId: "mulligan-redraw",
      actor: playerActor,
      command: { kind: "mulligan", cardInstanceIds: returnedCardInstanceIds },
    });
    if (!result.accepted) {
      throw new Error(`调度命令应被接受：${result.violation.message}`);
    }
    expect(result.accepted).toBe(true);
    expect(runtime.snapshot().game.phase).toBe("mulligan");
    const after = playerState(runtime.snapshot().game, "player");
    expect(after.mulliganReady).toBe(true);
    expect(after.blueprintHand).toHaveLength(5);
    expect(after.blueprintDeck).toHaveLength(19);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "mulligan_confirmed",
        payload: {
          seatId: "player",
          returnedCount: 2,
        },
      }),
    );
  });

  it("通过合法行动部署组织和模型，费用由同一规则层扣除", () => {
    const runtime = startMatch();
    const organizationAction = legalActions(runtime.snapshot().game, playerActor).find(
      (action) => action.kind === "deploy_organization",
    );
    if (!organizationAction) {
      throw new Error("测试种子应允许部署组织");
    }
    const organizationResult = runtime.dispatch({
      commandId: "deploy-organization",
      actor: playerActor,
      command: commandFromLegal(organizationAction),
    });
    expect(organizationResult.accepted).toBe(true);

    const deploymentSnapshot = runtime.snapshot();
    giveBlueprintCardToHand(deploymentSnapshot.game, "player", "model_smollm3");
    playerState(deploymentSnapshot.game, "player").compute = 9;
    const preparedDeployment = GameRuntime.restore(
      createModelMayhemDefinition(options),
      deploymentSnapshot,
    );
    const assetAction = legalActions(preparedDeployment.snapshot().game, playerActor).find(
      (action) => action.kind === "deploy_asset" && action.preview?.cardId === "model_smollm3",
    );
    if (!assetAction) {
      throw new Error("测试种子应允许部署模型");
    }
    const assetResult = preparedDeployment.dispatch({
      commandId: "deploy-model",
      actor: playerActor,
      command: commandFromLegal(assetAction),
    });
    expect(assetResult.accepted).toBe(true);
    const state = preparedDeployment.snapshot().game;
    expect(
      Object.values(state.assets).filter((asset) => asset.ownerSeatId === "player"),
    ).toHaveLength(1);
    expect(state.players.player?.compute).toBeLessThan(9);
    expect(state.players.player?.assetDeploysThisTurn).toBe(1);

    const defenderAction = legalActions(state, playerActor).find(
      (action) => action.kind === "set_benchmark_defender" && action.modelInstanceId !== null,
    );
    if (!defenderAction) {
      throw new Error("测试需要守擂设置行动");
    }
    const defenderResult = preparedDeployment.dispatch({
      commandId: "set-defender",
      actor: playerActor,
      command: commandFromLegal(defenderAction),
    });
    expect(defenderResult.accepted).toBe(true);
    expect(
      preparedDeployment.snapshot().game.players.player?.benchmarkDefenderModelInstanceId,
    ).not.toBeNull();
  });

  it("Benchmark 使用公开能力自动选择对手最高分模型并结算影响力", () => {
    const runtime = startMatch(9);
    const firstOrganization = legalActions(runtime.snapshot().game, playerActor).find(
      (action) => action.kind === "deploy_organization",
    );
    if (!firstOrganization) {
      throw new Error("测试需要可部署组织");
    }
    runtime.dispatch({
      commandId: "benchmark-setup-organization",
      actor: playerActor,
      command: commandFromLegal(firstOrganization),
    });
    const deploymentSnapshot = runtime.snapshot();
    giveBlueprintCardToHand(deploymentSnapshot.game, "player", "model_gpt_oss");
    playerState(deploymentSnapshot.game, "player").compute = 9;
    const preparedDeployment = GameRuntime.restore(
      createModelMayhemDefinition(options),
      deploymentSnapshot,
    );
    const modelAction = legalActions(preparedDeployment.snapshot().game, playerActor).find(
      (action) => action.kind === "deploy_asset" && action.preview?.cardId === "model_gpt_oss",
    );
    if (!modelAction) {
      throw new Error("测试需要可部署模型");
    }
    const modelResult = preparedDeployment.dispatch({
      commandId: "benchmark-setup-model",
      actor: playerActor,
      command: commandFromLegal(modelAction),
    });
    expect(modelResult.accepted).toBe(true);

    const snapshot = preparedDeployment.snapshot();
    playerState(snapshot.game, "player").compute = 9;
    playerState(snapshot.game, "player").actionHand.push({
      id: "test-standard-benchmark",
      cardId: "standard_benchmark",
    });
    const prepared = GameRuntime.restore(createModelMayhemDefinition(options), snapshot);
    const benchmarkAction = legalActions(prepared.snapshot().game, playerActor).find(
      (action) =>
        action.kind === "play_action" && action.actionInstanceId === "test-standard-benchmark",
    );
    if (!benchmarkAction) {
      throw new Error("测试需要合法 Benchmark 行动");
    }
    const result = prepared.dispatch({
      commandId: "play-standard-benchmark",
      actor: playerActor,
      command: commandFromLegal(benchmarkAction),
    });
    expect(result.accepted).toBe(true);
    const state = prepared.snapshot().game;
    expect(state.lastBenchmark?.ability).toBe("reasoning");
    expect(state.lastBenchmark?.defenderModelInstanceId).toBeNull();
    expect(state.players.player?.influence).toBeGreaterThanOrEqual(1);
    expect(state.players.player?.benchmarkWins).toBe(1);
  });

  it("Benchmark 优先使用守擂模型，并公开得分明细和大比分承压", () => {
    const { prepared, benchmarkAction } = prepareBenchmark("defender-model");
    const result = prepared.dispatch({
      commandId: "play-assigned-defender-benchmark",
      actor: playerActor,
      command: commandFromLegal(benchmarkAction),
    });
    if (!result.accepted) {
      throw new Error(`Benchmark 应被接受：${result.violation.message}`);
    }
    const benchmark = prepared.snapshot().game.lastBenchmark;
    expect(benchmark?.defenderSelection).toBe("assigned");
    expect(benchmark?.defenderModelInstanceId).toBe("defender-model");
    expect(benchmark?.challengerBase).toBe(5);
    expect(benchmark?.defenderBase).toBe(2);
    expect(benchmark?.scoreDifference).toBe(3);
    expect(benchmark?.pressureTurnsApplied).toBe(2);
    expect(benchmark?.challengerModifiers).toEqual([]);
    expect(benchmark?.defenderModifiers).toEqual([]);
    expect(
      prepared
        .snapshot()
        .game.assets["defender-model"]?.statuses.find((status) => status.id === "pressure")
        ?.remainingTurns,
    ).toBe(2);
  });

  it("守擂模型失去资格时自动回退到最高分模型", () => {
    const { prepared, benchmarkAction } = prepareBenchmark("missing-defender", "open_reasoning");
    const result = prepared.dispatch({
      commandId: "play-fallback-defender-benchmark",
      actor: playerActor,
      command: commandFromLegal(benchmarkAction),
    });
    if (!result.accepted) {
      throw new Error(`Benchmark 应被接受：${result.violation.message}`);
    }
    const benchmark = prepared.snapshot().game.lastBenchmark;
    expect(benchmark?.defenderSelection).toBe("automatic");
    expect(benchmark?.defenderModelInstanceId).toBe("defender-model");
  });

  it("轮次上限只比较最终影响力，统计优势不能代替胜利进度", () => {
    const runtime = startMatch(9);
    const snapshot = runtime.snapshot();
    snapshot.game.round = content.balance.roundLimit;
    snapshot.game.turnOrderIndex = 1;
    snapshot.game.activeSeatId = "agent";
    playerState(snapshot.game, "player").benchmarkWins = 9;
    playerState(snapshot.game, "agent").benchmarkWins = 0;
    const prepared = GameRuntime.restore(createModelMayhemDefinition(options), snapshot);
    const result = prepared.dispatch({
      commandId: "finish-round-limit",
      actor: agentActor,
      command: { kind: "end_turn" },
    });
    expect(result.accepted).toBe(true);
    expect(prepared.snapshot().game.phase).toBe("finished");
    expect(prepared.snapshot().game.isDraw).toBe(true);
    expect(prepared.snapshot().game.finishReason).toBe("round_limit");
  });

  it("技术检定答错仍执行基础效果", () => {
    const runtime = startMatch();
    const snapshot = runtime.snapshot();
    playerState(snapshot.game, "player").compute = 9;
    playerState(snapshot.game, "player").actionHand.push({
      id: "test-signature",
      cardId: "open_weight_release",
    });
    const prepared = GameRuntime.restore(createModelMayhemDefinition(options), snapshot);
    const play = legalActions(prepared.snapshot().game, playerActor).find(
      (action) => action.kind === "play_action" && action.actionInstanceId === "test-signature",
    );
    if (!play) {
      throw new Error("测试需要合法招牌行动");
    }
    const pending = prepared.dispatch({
      commandId: "play-signature",
      actor: playerActor,
      command: commandFromLegal(play),
    });
    expect(pending.accepted).toBe(true);
    expect(prepared.snapshot().game.pendingTechCheck).not.toBeNull();

    const resolve = legalActions(prepared.snapshot().game, playerActor).find(
      (action) => action.kind === "resolve_tech_check" && action.optionId !== "a",
    );
    if (!resolve) {
      throw new Error("测试需要错误选项");
    }
    const result = prepared.dispatch({
      commandId: "resolve-signature",
      actor: playerActor,
      command: commandFromLegal(resolve),
    });
    expect(result.accepted).toBe(true);
    const state = prepared.snapshot().game;
    expect(state.pendingTechCheck).toBeNull();
    expect(state.players.player?.influence).toBe(1);
  });

  it("固定种子和命令序列产生相同事件", () => {
    const left = startMatch(42);
    const right = startMatch(42);
    const leftOrganization = legalActions(left.snapshot().game, playerActor).find(
      (action) => action.kind === "deploy_organization",
    );
    const rightOrganization = legalActions(right.snapshot().game, playerActor).find(
      (action) => action.kind === "deploy_organization",
    );
    expect(leftOrganization).toEqual(rightOrganization);
    if (!leftOrganization || !rightOrganization) {
      throw new Error("测试种子应产生组织");
    }
    const leftResult = left.dispatch({
      commandId: "same-command",
      actor: playerActor,
      command: commandFromLegal(leftOrganization),
    });
    const rightResult = right.dispatch({
      commandId: "same-command",
      actor: playerActor,
      command: commandFromLegal(rightOrganization),
    });
    expect(leftResult).toEqual(rightResult);
  });

  it("六种特效攻击分别修改真实资源、状态、得分、费用和影响力", () => {
    const computeAttack = prepareAction("compute_pressure_attack", (snapshot) => {
      playerState(snapshot.game, "agent").compute = 4;
    });
    const computeBefore = playerState(computeAttack.runtime.snapshot().game, "agent").compute;
    const computeResult = computeAttack.runtime.dispatch({
      commandId: "attack-compute",
      actor: playerActor,
      command: {
        kind: "play_action",
        actionInstanceId: computeAttack.actionInstanceId,
      },
    });
    expect(computeResult.accepted).toBe(true);
    expect(playerState(computeAttack.runtime.snapshot().game, "agent").compute).toBe(
      computeBefore - 1,
    );

    const capitalAttack = prepareAction("capital_pressure_attack");
    const capitalBefore = playerState(capitalAttack.runtime.snapshot().game, "agent").capital;
    const capitalResult = capitalAttack.runtime.dispatch({
      commandId: "attack-capital",
      actor: playerActor,
      command: {
        kind: "play_action",
        actionInstanceId: capitalAttack.actionInstanceId,
      },
    });
    expect(capitalResult.accepted).toBe(true);
    expect(playerState(capitalAttack.runtime.snapshot().game, "agent").capital).toBe(
      capitalBefore - 1,
    );

    const scoreAttack = prepareAction("score_pressure_attack", (snapshot) => {
      addModelToSnapshot(snapshot.game, "agent", "target-model", "small_efficient");
    });
    const scoreResult = scoreAttack.runtime.dispatch({
      commandId: "attack-score",
      actor: playerActor,
      command: {
        kind: "play_action",
        actionInstanceId: scoreAttack.actionInstanceId,
        targetModelInstanceId: "target-model",
      },
    });
    expect(scoreResult.accepted).toBe(true);
    expect(playerState(scoreAttack.runtime.snapshot().game, "agent").timedModifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetModelInstanceId: "target-model",
          effect: expect.objectContaining({
            kind: "modify_model_score",
            amount: -1,
          }),
        }),
      ]),
    );

    const statusAttack = prepareAction("status_pressure_attack");
    const statusState = statusAttack.runtime.snapshot().game;
    const opponentAnchor = Object.values(statusState.anchors).find(
      (anchor) => anchor.ownerSeatId === "agent",
    );
    if (!opponentAnchor) {
      throw new Error("状态攻击测试缺少对手据点");
    }
    const statusResult = statusAttack.runtime.dispatch({
      commandId: "attack-status",
      actor: playerActor,
      command: {
        kind: "play_action",
        actionInstanceId: statusAttack.actionInstanceId,
        targetAnchorId: opponentAnchor.id,
      },
    });
    expect(statusResult.accepted).toBe(true);
    expect(
      statusAttack.runtime
        .snapshot()
        .game.anchors[opponentAnchor.id]?.statuses.some((status) => status.id === "controversy"),
    ).toBe(true);

    const costAttack = prepareAction("cost_pressure_attack");
    const costResult = costAttack.runtime.dispatch({
      commandId: "attack-cost",
      actor: playerActor,
      command: {
        kind: "play_action",
        actionInstanceId: costAttack.actionInstanceId,
      },
    });
    expect(costResult.accepted).toBe(true);
    expect(playerState(costAttack.runtime.snapshot().game, "agent").timedModifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effect: expect.objectContaining({
            kind: "modify_cost",
            amount: 1,
          }),
        }),
      ]),
    );

    const influenceAttack = prepareAction("influence_pressure_attack", (snapshot) => {
      playerState(snapshot.game, "agent").influence = 2;
    });
    const influenceResult = influenceAttack.runtime.dispatch({
      commandId: "attack-influence",
      actor: playerActor,
      command: {
        kind: "play_action",
        actionInstanceId: influenceAttack.actionInstanceId,
      },
    });
    if (!influenceResult.accepted) {
      throw new Error(`影响力夺取行动应被接受：${influenceResult.violation.message}`);
    }
    const influenceState = influenceAttack.runtime.snapshot().game;
    expect(playerState(influenceState, "player").influence).toBe(1);
    expect(playerState(influenceState, "agent").influence).toBe(1);
    expect(influenceResult.events).toContainEqual(
      expect.objectContaining({
        type: "effect_attack_resolved",
        payload: expect.objectContaining({
          attackType: "influence_pressure",
          amount: 1,
        }),
      }),
    );
  });

  it("基础行动池只包含十二张基础行动和两张招牌行动", () => {
    const runtime = startMatch(9);
    const pool = buildActionPool(content, runtime.snapshot().game, "player");
    const uniqueIds = new Set(pool.map((entry) => entry.cardId));
    const signatureCount = pool.filter(
      (entry) => content.actions.get(entry.cardId)?.signature === true,
    ).length;
    expect(pool).toHaveLength(14);
    expect(uniqueIds.size).toBe(14);
    expect(signatureCount).toBe(2);
  });

  it("同名行动每轮只能获得一次影响力，但其他效果仍可结算", () => {
    const runtime = startMatch(9);
    const snapshot = runtime.snapshot();
    const player = playerState(snapshot.game, "player");
    const opponent = playerState(snapshot.game, "agent");
    player.compute = 9;
    opponent.capital = 5;
    player.actionHand.push(
      { id: "test-price-cut-1", cardId: "price_cut" },
      { id: "test-price-cut-2", cardId: "price_cut" },
    );
    const prepared = GameRuntime.restore(createModelMayhemDefinition(options), snapshot);
    for (const actionInstanceId of ["test-price-cut-1", "test-price-cut-2"]) {
      const result = prepared.dispatch({
        commandId: `play-${actionInstanceId}`,
        actor: playerActor,
        command: {
          kind: "play_action",
          actionInstanceId,
        },
      });
      if (!result.accepted) {
        throw new Error(`同名行动测试应被接受：${result.violation.message}`);
      }
    }
    const state = prepared.snapshot().game;
    expect(playerState(state, "player").influence).toBe(1);
    expect(playerState(state, "agent").capital).toBe(3);
  });
});
