/**
 * Pi 对战工具白名单与真实语义行动测试。
 *
 * 作者：JucieOvo
 *
 * 测试不调用 DeepSeek，只使用真实规则运行时和统一工具网关验证隔离边界。
 */

import { DirectBattleToolClient } from "@modelmayhem/game-client";
import { GameRuntime } from "@modelmayhem/game-kernel";
import type { ToolBackend, ToolContext } from "@modelmayhem/game-tools";
import { createToolGateway } from "@modelmayhem/game-tools";
import { loadContentPack } from "@modelmayhem/model-mayhem-content";
import {
  createModelMayhemDefinition,
  generateLegalActions,
  ModelMayhemCommandSchema,
  projectModelMayhemView,
} from "@modelmayhem/model-mayhem-rules";
import { simulateModelMayhemCommand } from "@modelmayhem/simulator";
import { describe, expect, it } from "vitest";
import { buildPiBattleSystemPrompt, createPiBattleTools, getAgentDifficultyBudget } from "./index";

function createFixture() {
  const content = loadContentPack();
  const seats = [
    { seatId: "agent", displayName: "Agent", deckId: "frontier_scaling_starter" },
    { seatId: "player", displayName: "玩家", deckId: "open_diffusion_starter" },
  ] as const;
  const options = { content, seats };
  const runtime = GameRuntime.create(createModelMayhemDefinition(options), {
    gameId: "pi-test",
    seed: 9,
    seats: [
      { id: "agent", displayName: "Agent" },
      { id: "player", displayName: "玩家" },
    ],
  });
  const events: unknown[] = [];
  runtime.subscribe((event) => events.push(event));

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
      return {
        view: projectModelMayhemView(content, runtime.snapshot().game, {
          seatId: context.seatId,
          kind: context.actorKind,
        }),
        availableActions: semanticActions(context),
      };
    },
    async inspectCard(cardId) {
      return content.cards.get(cardId);
    },
    async inspectRules() {
      return content.manifest;
    },
    async simulateAction(context, action) {
      return simulateModelMayhemCommand(
        options,
        runtime.snapshot(),
        { seatId: context.seatId, kind: context.actorKind },
        ModelMayhemCommandSchema.parse(action),
      );
    },
    async submitAction(context, action) {
      return runtime.dispatch({
        commandId: "pi-command",
        actor: { seatId: context.seatId, kind: context.actorKind },
        command: ModelMayhemCommandSchema.parse(action),
      });
    },
    async waitForTurn(context) {
      return {
        active: runtime.snapshot().game.activeSeatId === context.seatId,
      };
    },
    async getResearchMap() {
      return {
        researchData: 0,
        nodes: [...content.researchNodes.values()].map((node) => ({
          nodeId: node.id,
          unlocked: false,
          available: node.depth === 1,
          cost: node.cost,
          rewardCardIds: node.rewardCardIds,
        })),
      };
    },
    async updateDeck() {
      throw new Error("Pi 工具白名单测试不执行牌组写入");
    },
    async getReplay() {
      return { events };
    },
  };
  const gateway = createToolGateway(backend, ModelMayhemCommandSchema);
  const context: ToolContext = {
    matchId: "pi-test",
    seatId: "agent",
    actorKind: "agent",
    profileId: "local",
    permissions: ["read", "play", "progress", "replay"],
  };
  return {
    client: new DirectBattleToolClient(gateway, context),
  };
}

describe("Pi 对战工具", () => {
  it("系统提示词注入完整规则文档、战斗说明和财团边界", () => {
    const prompt = buildPiBattleSystemPrompt("standard");
    expect(prompt).toContain("# Model Mayhem 对战规则");
    expect(prompt).toContain("# Model Mayhem 战斗说明");
    expect(prompt).toContain("双方属于相反财团");
    expect(prompt).toContain("不参与牌组编辑、研究地图推进");
    expect(prompt).toContain("不得访问、创建、修改或删除系统目录、用户主目录");
  });

  it("三种难度使用不同的真实工具与规划预算", () => {
    expect(getAgentDifficultyBudget("trainee")).toEqual({
      maxToolCalls: 8,
      planningDepth: 1,
    });
    expect(getAgentDifficultyBudget("standard")).toEqual({
      maxToolCalls: 14,
      planningDepth: 2,
    });
    expect(getAgentDifficultyBudget("adversarial")).toEqual({
      maxToolCalls: 20,
      planningDepth: 3,
    });
  });

  it("只暴露语义行动，不要求模型处理 actionId 或 commandId", async () => {
    const tools = createPiBattleTools(createFixture().client);
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(["get_turn_context", "simulate_action", "perform_action"]);
    for (const forbidden of [
      "inspect_card",
      "get_match_state",
      "get_private_state",
      "get_legal_actions",
      "submit_action",
      "end_turn",
      "wait_for_turn",
      "read",
      "write",
      "bash",
      "powershell",
    ]) {
      expect(names).not.toContain(forbidden);
    }

    const turnContextTool = tools.find((tool) => tool.name === "get_turn_context");
    if (!turnContextTool) {
      throw new Error("缺少完整回合上下文工具");
    }
    const turnContextResult = await turnContextTool.execute("call-1", {});
    const turnContext = JSON.parse(
      turnContextResult.content[0]?.type === "text" ? turnContextResult.content[0].text : "{}",
    ) as {
      readonly availableActions: readonly {
        readonly label: string;
        readonly action: { readonly kind: string };
      }[];
      readonly view: { readonly phase: string };
    };
    expect(turnContext.view.phase).toBe("mulligan");
    expect(turnContext.availableActions).toHaveLength(32);
    expect(turnContext.availableActions[0]?.action.kind).toBe("mulligan");

    const performTool = tools.find((tool) => tool.name === "perform_action");
    const simulateTool = tools.find((tool) => tool.name === "simulate_action");
    if (!performTool || !simulateTool) {
      throw new Error("缺少语义行动工具");
    }
    const performParameters = performTool.parameters as {
      readonly properties?: Readonly<Record<string, unknown>>;
    };
    const simulateParameters = simulateTool.parameters as {
      readonly properties?: Readonly<Record<string, unknown>>;
    };
    expect(Object.keys(performParameters.properties ?? {})).toEqual(["action"]);
    expect(Object.keys(simulateParameters.properties ?? {})).toEqual(["action"]);

    const mulliganAction = turnContext.availableActions[0]?.action;
    if (!mulliganAction) {
      throw new Error("缺少可执行的调度行动");
    }
    const submitted = await performTool.execute("call-2", { action: mulliganAction });
    const submittedPayload = JSON.parse(
      submitted.content[0]?.type === "text" ? submitted.content[0].text : "{}",
    ) as { readonly accepted: boolean };
    expect(submittedPayload.accepted).toBe(true);
  });

  it("语义行动失败时返回当前可用行动，供 Agent 重新选择", async () => {
    const tools = createPiBattleTools(createFixture().client);
    const performTool = tools.find((tool) => tool.name === "perform_action");
    if (!performTool) {
      throw new Error("缺少语义行动工具");
    }
    await expect(
      performTool.execute("call-stale", {
        action: { kind: "end_turn" },
      }),
    ).rejects.toThrow(/availableActions/);
    await expect(
      performTool.execute("call-invalid-shape", {
        action: { kind: "end_turn", unexpected: true },
      }),
    ).rejects.toThrow(/availableActions/);
  });
});
