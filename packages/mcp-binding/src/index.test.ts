/**
 * MCP 协议绑定真实进程内测试。
 *
 * 作者：JucieOvo
 *
 * 测试通过 MCP 2.0 客户端连接真实 McpServer，验证 tools/list 与 tools/call
 * 都走统一工具网关。测试不访问网络，也不调用大语言模型。
 */

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { GameRuntime } from "@modelmayhem/game-kernel";
import type { ToolBackend, ToolContext } from "@modelmayhem/game-tools";
import { createToolGateway } from "@modelmayhem/game-tools";
import { loadContentPack } from "@modelmayhem/model-mayhem-content";
import type { ModelMayhemDefinitionOptions } from "@modelmayhem/model-mayhem-rules";
import {
  createModelMayhemDefinition,
  generateLegalActions,
  ModelMayhemCommandSchema,
  projectModelMayhemView,
} from "@modelmayhem/model-mayhem-rules";
import { simulateModelMayhemCommand } from "@modelmayhem/simulator";
import { afterEach, describe, expect, it } from "vitest";
import { createModelMayhemMcpServer } from "./index";

const resources: (() => Promise<void>)[] = [];

function createFixture() {
  const content = loadContentPack();
  const seats = [
    { seatId: "agent", displayName: "Agent", deckId: "frontier_scaling_starter" },
    { seatId: "player", displayName: "玩家", deckId: "open_diffusion_starter" },
  ] as const;
  const options: ModelMayhemDefinitionOptions = { content, seats };
  const runtime = GameRuntime.create(createModelMayhemDefinition(options), {
    gameId: "mcp-match",
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
        commandId: "mcp-command",
        actor: { seatId: context.seatId, kind: context.actorKind },
        command: ModelMayhemCommandSchema.parse(action),
      });
    },
    async waitForTurn(context) {
      return { active: runtime.snapshot().game.activeSeatId === context.seatId };
    },
    async getResearchMap() {
      return {
        researchData: 0,
        nodes: [...content.researchNodes.values()].map((node) => ({
          nodeId: node.id,
          branch: node.branch,
          name: node.name,
          depth: node.depth,
          unlocked: false,
          available: node.depth === 1,
          cost: node.cost,
          rewardCardIds: node.rewardCardIds,
          missingResearchData: node.cost,
        })),
      };
    },
    async updateDeck() {
      throw new Error("MCP 协议测试不执行牌组写入");
    },
    async getReplay() {
      return { events };
    },
  };
  const context: ToolContext = {
    matchId: "mcp-match",
    seatId: "agent",
    actorKind: "agent",
    profileId: "local",
    permissions: ["read", "play", "progress", "replay"],
  };
  return {
    gateway: createToolGateway(backend, ModelMayhemCommandSchema),
    context,
  };
}

afterEach(async () => {
  for (const cleanup of resources.splice(0)) {
    await cleanup();
  }
});

describe("MCP 绑定", () => {
  it("通过标准工具列表和工具调用访问真实规则网关", async () => {
    const fixture = createFixture();
    const server = createModelMayhemMcpServer(
      {
        gateway: fixture.gateway,
        contextFactory: () => fixture.context,
      },
      { era: "modern" },
    );
    const client = new Client({ name: "model-mayhem-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    resources.push(async () => {
      await client.close();
      await server.close();
    });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "get_turn_context",
      "get_match_state",
      "get_private_state",
      "inspect_card",
      "inspect_rules",
      "simulate_action",
      "perform_action",
      "wait_for_turn",
      "get_research_map",
      "update_deck",
      "get_replay",
    ]);

    const result = await client.callTool({
      name: "get_match_state",
      arguments: {},
    });
    expect(result.content).toHaveLength(1);
    const firstContent = result.content[0];
    if (firstContent?.type !== "text") {
      throw new Error("MCP 工具应返回文本内容");
    }
    const view = JSON.parse(firstContent.text) as {
      readonly viewerSeatId: string;
      readonly phase: string;
    };
    expect(view.viewerSeatId).toBe("agent");
    expect(view.phase).toBe("mulligan");

    const availableResources = await client.listResources();
    expect(availableResources.resources.map((resource) => resource.uri)).toEqual(
      expect.arrayContaining(["modelmayhem://rules/combat", "modelmayhem://guides/battle"]),
    );
    const combatRules = await client.readResource({ uri: "modelmayhem://rules/combat" });
    const rulesContent = combatRules.contents[0];
    if (!rulesContent || !("text" in rulesContent)) {
      throw new Error("规则资源应返回 Markdown 文本");
    }
    expect(rulesContent.text).toContain("# Model Mayhem 对战规则");
  });
});
