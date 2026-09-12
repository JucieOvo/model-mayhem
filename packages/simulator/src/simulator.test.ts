/**
 * 模拟器确定性测试。
 *
 * 作者：JucieOvo
 */

import { GameRuntime } from "@modelmayhem/game-kernel";
import { loadContentPack } from "@modelmayhem/model-mayhem-content";
import { createModelMayhemDefinition, generateLegalActions } from "@modelmayhem/model-mayhem-rules";
import { describe, expect, it } from "vitest";
import { simulateModelMayhemCommand } from "./index";

describe("Model Mayhem 模拟器", () => {
  it("模拟部署不会修改原始快照", () => {
    const content = loadContentPack();
    const seats = [
      { seatId: "a", displayName: "甲", deckId: "open_diffusion_starter" },
      { seatId: "b", displayName: "乙", deckId: "frontier_scaling_starter" },
    ] as const;
    const options = { content, seats };
    const runtime = GameRuntime.create(createModelMayhemDefinition(options), {
      gameId: "simulation-match",
      seed: 9,
      seats: [
        { id: "a", displayName: "甲" },
        { id: "b", displayName: "乙" },
      ],
    });
    runtime.dispatch({
      commandId: "mulligan-a",
      actor: { seatId: "a", kind: "human" },
      command: { kind: "mulligan", cardInstanceIds: [] },
    });
    runtime.dispatch({
      commandId: "mulligan-b",
      actor: { seatId: "b", kind: "agent" },
      command: { kind: "mulligan", cardInstanceIds: [] },
    });
    while (
      (runtime.snapshot().game.players.a?.blueprintHand.length ?? 0) >
      content.balance.blueprintHandLimit
    ) {
      const cardInstanceId = runtime.snapshot().game.players.a?.blueprintHand[0];
      if (!cardInstanceId) {
        throw new Error("测试缺少待弃置蓝图");
      }
      runtime.dispatch({
        commandId: `discard-blueprint-${cardInstanceId}`,
        actor: { seatId: "a", kind: "human" },
        command: {
          kind: "discard_blueprint",
          cardInstanceId,
        },
      });
    }
    while (
      (runtime.snapshot().game.players.a?.actionHand.length ?? 0) > content.balance.actionHandLimit
    ) {
      const discard = generateLegalActions(options, runtime.snapshot().game, {
        seatId: "a",
        kind: "human",
      }).find((action) => action.kind === "discard_action");
      if (!discard) {
        throw new Error("测试缺少待弃置行动");
      }
      runtime.dispatch({
        commandId: `discard-${discard.actionInstanceId}`,
        actor: { seatId: "a", kind: "human" },
        command: {
          kind: "discard_action",
          actionInstanceId: discard.actionInstanceId,
        },
      });
    }
    const original = runtime.snapshot();
    const legal = generateLegalActions(options, original.game, {
      seatId: "a",
      kind: "human",
    });
    const deploy = legal.find((action) => action.kind === "deploy_organization");
    if (deploy?.kind !== "deploy_organization") {
      throw new Error("测试需要合法部署");
    }
    const before = structuredClone(original);
    const result = simulateModelMayhemCommand(
      options,
      original,
      { seatId: "a", kind: "human" },
      {
        kind: "deploy_organization",
        cardInstanceId: deploy.cardInstanceId,
        slotIndex: deploy.slotIndex,
      },
    );
    expect(result.accepted).toBe(true);
    expect(original).toEqual(before);
    expect(runtime.snapshot()).toEqual(before);
  });
});
