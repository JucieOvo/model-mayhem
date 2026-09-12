/**
 * 工具网关权限与复用测试。
 *
 * 作者：JucieOvo
 *
 * 测试使用真实规则运行时作为后端，验证座位权限、顺序执行标记和命令提交。
 */

import { GameRuntime } from "@modelmayhem/game-kernel";
import { loadContentPack } from "@modelmayhem/model-mayhem-content";
import type { ModelMayhemDefinitionOptions } from "@modelmayhem/model-mayhem-rules";
import {
  createModelMayhemDefinition,
  generateLegalActions,
  ModelMayhemCommandSchema,
  projectModelMayhemView,
} from "@modelmayhem/model-mayhem-rules";
import { describe, expect, it } from "vitest";
import { createToolGateway } from "./registry";
import type { ToolBackend, ToolContext } from "./types";
import { ToolGatewayError } from "./types";

function createBackendFixture() {
  const content = loadContentPack();
  const seats = [
    { seatId: "player", displayName: "玩家", deckId: "open_diffusion_starter" },
    { seatId: "agent", displayName: "陪练 Agent", deckId: "frontier_scaling_starter" },
  ] as const;
  const options: ModelMayhemDefinitionOptions = { content, seats };
  const runtime = GameRuntime.create(createModelMayhemDefinition(options), {
    gameId: "tools-match",
    seed: 9,
    seats: [
      { id: "player", displayName: "玩家" },
      { id: "agent", displayName: "陪练 Agent" },
    ],
  });
  runtime.dispatch({
    commandId: "mulligan-player",
    actor: { seatId: "player", kind: "human" },
    command: { kind: "mulligan", cardInstanceIds: [] },
  });
  runtime.dispatch({
    commandId: "mulligan-agent",
    actor: { seatId: "agent", kind: "agent" },
    command: { kind: "mulligan", cardInstanceIds: [] },
  });
  while (
    (runtime.snapshot().game.players.player?.blueprintHand.length ?? 0) >
    content.balance.blueprintHandLimit
  ) {
    const cardInstanceId = runtime.snapshot().game.players.player?.blueprintHand[0];
    if (!cardInstanceId) {
      throw new Error("测试缺少待弃置蓝图");
    }
    runtime.dispatch({
      commandId: `discard-blueprint-${cardInstanceId}`,
      actor: { seatId: "player", kind: "human" },
      command: {
        kind: "discard_blueprint",
        cardInstanceId,
      },
    });
  }
  while (
    (runtime.snapshot().game.players.player?.actionHand.length ?? 0) >
    content.balance.actionHandLimit
  ) {
    const discard = generateLegalActions(options, runtime.snapshot().game, {
      seatId: "player",
      kind: "human",
    }).find((action) => action.kind === "discard_action");
    if (!discard) {
      throw new Error("测试缺少待弃置行动");
    }
    runtime.dispatch({
      commandId: `discard-${discard.actionInstanceId}`,
      actor: { seatId: "player", kind: "human" },
      command: {
        kind: "discard_action",
        actionInstanceId: discard.actionInstanceId,
      },
    });
  }

  function semanticActions(context: ToolContext): readonly unknown[] {
    return generateLegalActions(options, runtime.snapshot().game, {
      seatId: context.seatId,
      kind: context.actorKind,
    }).map(({ id: _id, label, preview, ...action }) => ({
      label,
      action,
      ...(preview ? { preview } : {}),
    }));
  }

  const backend: ToolBackend = {
    async getMatchState(context) {
      return projectModelMayhemView(content, runtime.snapshot().game, {
        seatId: context.seatId,
        kind: context.actorKind,
      });
    },
    async getPrivateState(context) {
      return projectModelMayhemView(content, runtime.snapshot().game, {
        seatId: context.seatId,
        kind: context.actorKind,
      }).me;
    },
    async getLegalActions(context) {
      return semanticActions(context);
    },
    async getTurnContext(context) {
      const view = projectModelMayhemView(content, runtime.snapshot().game, {
        seatId: context.seatId,
        kind: context.actorKind,
      });
      return {
        view,
        availableActions: semanticActions(context),
      };
    },
    async inspectCard(cardId) {
      return content.cards.get(cardId);
    },
    async inspectRules() {
      return content.manifest;
    },
    async simulateAction(_context, action) {
      return ModelMayhemCommandSchema.parse(action);
    },
    async submitAction(context, action) {
      return runtime.dispatch({
        commandId: "gateway-command",
        actor: { seatId: context.seatId, kind: context.actorKind },
        command: ModelMayhemCommandSchema.parse(action),
      });
    },
    async waitForTurn() {
      return { active: true };
    },
    async getResearchMap() {
      return { researchData: 0, collectionCardIds: [], nodes: [] };
    },
    async updateDeck(_context, deck) {
      return deck;
    },
    async getReplay() {
      return { events: [] };
    },
  };
  return { content, options, runtime, backend };
}

const playerContext: ToolContext = {
  matchId: "tools-match",
  seatId: "player",
  actorKind: "human",
  profileId: "local",
  permissions: ["read", "play", "progress", "replay"],
};

describe("ToolGateway", () => {
  it("提交工具使用顺序执行，查询工具允许并行", () => {
    const gateway = createToolGateway(createBackendFixture().backend, ModelMayhemCommandSchema);
    expect(gateway.executionMode("perform_action")).toBe("sequential");
    expect(gateway.executionMode("get_match_state")).toBe("parallel");
    expect(gateway.executionMode("simulate_action")).toBe("parallel");
  });

  it("拒绝缺少权限的座位读取私有状态", async () => {
    const gateway = createToolGateway(createBackendFixture().backend, ModelMayhemCommandSchema);
    await expect(
      gateway.execute("get_private_state", {}, { ...playerContext, permissions: ["play"] }),
    ).rejects.toEqual(new ToolGatewayError("TOOL_PERMISSION_DENIED", "座位 player 没有 read 权限"));
  });

  it("通过统一网关提交真实合法行动", async () => {
    const fixture = createBackendFixture();
    const gateway = createToolGateway(fixture.backend, ModelMayhemCommandSchema);
    const context = (await gateway.execute("get_turn_context", {}, playerContext)) as {
      readonly availableActions: readonly {
        readonly label: string;
        readonly action: {
          readonly kind: string;
        };
      }[];
    };
    const legal = context.availableActions;
    const organization = legal.find((entry) => entry.action.kind === "deploy_organization");
    if (!organization) {
      throw new Error("真实内容应提供合法部署");
    }
    const result = (await gateway.execute(
      "perform_action",
      organization.action,
      playerContext,
    )) as { readonly accepted: boolean };
    expect(result.accepted).toBe(true);
  });
});
