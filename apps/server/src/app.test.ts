/**
 * Hono 对局服务合约测试。
 *
 * 作者：JucieOvo
 *
 * 测试使用真实内容、真实 SQLite 临时数据库和 Hono 请求入口，不启动网络端口，
 * 也不调用任何大语言模型。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadContentPack } from "@modelmayhem/model-mayhem-content";
import { openPersistence, PersistenceStore } from "@modelmayhem/persistence";
import { afterEach, describe, expect, it } from "vitest";
import type { ServerRuntime } from "./app";
import { createServerRuntime } from "./app";

const runtimes: ServerRuntime[] = [];
const directories: string[] = [];

function createRuntime(): ServerRuntime {
  const directory = mkdtempSync(join(tmpdir(), "model-mayhem-server-"));
  directories.push(directory);
  const persistence = openPersistence(join(directory, "server.sqlite"));
  const content = loadContentPack();
  const runtime = createServerRuntime({
    content,
    persistence,
    store: new PersistenceStore(persistence.db),
    profileId: "local",
    seedFactory: () => 9,
  });
  runtimes.push(runtime);
  return runtime;
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    await runtime.close();
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Model Mayhem Hono 服务", () => {
  it("返回真实规则与内容版本", async () => {
    const runtime = createRuntime();
    const response = await runtime.app.request("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      rulesetId: "model-mayhem",
      rulesetVersion: "0.2.1",
      contentVersion: "0.2.1",
    });
  });

  it("创建对局并允许玩家令牌读取自身视图", async () => {
    const runtime = createRuntime();
    const factionResponse = await runtime.app.request("/api/profile/faction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faction: "china" }),
    });
    expect(factionResponse.status).toBe(200);
    const createResponse = await runtime.app.request("/api/matches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deckId: "open_diffusion_starter",
        difficulty: "trainee",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      readonly matchId: string;
      readonly seatToken: string;
    };
    const viewResponse = await runtime.app.request(`/api/matches/${created.matchId}`, {
      headers: {
        authorization: `Bearer ${created.seatToken}`,
      },
    });
    expect(viewResponse.status).toBe(200);
    const view = (await viewResponse.json()) as {
      readonly view: {
        readonly viewerSeatId: string;
        readonly me: {
          readonly blueprintHand: readonly {
            readonly instanceId: string;
            readonly cardId: string;
          }[];
        };
      };
    };
    expect(view.view.viewerSeatId).toBe("player");
    expect(view.view.me.blueprintHand).toHaveLength(5);

    const playerView = runtime.matchService.getView(created.matchId, "player");
    const agentView = runtime.matchService.getView(created.matchId, "agent");
    expect(
      agentView.me.blueprintDeckComposition.reduce((total, card) => total + card.count, 0),
    ).toBe(24);
    expect(playerView.me.doctrineId).toBe("open_diffusion");
    expect(agentView.me.doctrineId).toBeTruthy();
    expect(playerView.me.faction).toBe("china");
    expect(agentView.me.faction).toBe("west");

    const playerMulliganActions = runtime.matchService.getLegalActions(created.matchId, "player");
    const agentMulliganActions = runtime.matchService.getLegalActions(created.matchId, "agent");
    expect(playerMulliganActions).toHaveLength(32);
    expect(agentMulliganActions.length).toBeGreaterThan(0);
    expect(agentMulliganActions.length).toBeLessThanOrEqual(4);
    expect(agentMulliganActions.every((action) => action.kind === "mulligan")).toBe(true);
    expect(agentMulliganActions[0]?.label).toBe("保留全部起始手牌");
  });

  it("回合工具上下文提供己方完整卡牌，但不暴露对手手牌", async () => {
    const runtime = createRuntime();
    await runtime.app.request("/api/profile/faction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faction: "china" }),
    });
    const createResponse = await runtime.app.request("/api/matches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deckId: "open_diffusion_starter",
        difficulty: "trainee",
      }),
    });
    const created = (await createResponse.json()) as {
      readonly matchId: string;
      readonly seatToken: string;
    };
    const response = await runtime.app.request(`/api/matches/${created.matchId}/turn-context`, {
      headers: {
        authorization: `Bearer ${created.seatToken}`,
      },
    });
    expect(response.status).toBe(200);
    const context = (await response.json()) as {
      readonly ownCards: readonly {
        readonly id: string;
        readonly effects?: readonly unknown[];
        readonly passiveEffects?: readonly unknown[];
      }[];
      readonly ownBlueprintDeck: readonly {
        readonly cardId: string;
        readonly count: number;
      }[];
      readonly opponent: Readonly<Record<string, unknown>>;
    };
    expect(context.ownCards.length).toBeGreaterThan(0);
    expect(
      context.ownCards.some(
        (card) => (card.effects?.length ?? 0) > 0 || (card.passiveEffects?.length ?? 0) > 0,
      ),
    ).toBe(true);
    expect(context.ownBlueprintDeck.reduce((total, card) => total + card.count, 0)).toBe(24);
    expect(context.opponent).not.toHaveProperty("blueprintHand");
    expect(context.opponent).not.toHaveProperty("actionHand");
  });

  it("档案财团确定后不能通过普通接口更换", async () => {
    const runtime = createRuntime();
    const first = await runtime.app.request("/api/profile/faction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faction: "china" }),
    });
    expect(first.status).toBe(200);
    const change = await runtime.app.request("/api/profile/faction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faction: "west" }),
    });
    expect(change.status).toBe(409);
  });

  it("未选择财团时不能创建对局", async () => {
    const runtime = createRuntime();
    const response = await runtime.app.request("/api/matches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deckId: "open_diffusion_starter",
        difficulty: "trainee",
      }),
    });
    expect(response.status).toBe(409);
  });

  it("档案不能使用对方财团预组创建对局", async () => {
    const runtime = createRuntime();
    await runtime.app.request("/api/profile/faction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faction: "china" }),
    });
    const response = await runtime.app.request("/api/matches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deckId: "frontier_scaling_starter",
        difficulty: "trainee",
      }),
    });
    expect(response.status).toBe(422);
  });

  it("保存自定义牌组后可以直接使用该牌组创建对局", async () => {
    const runtime = createRuntime();
    await runtime.app.request("/api/profile/faction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faction: "china" }),
    });
    const contentResponse = await runtime.app.request("/api/content");
    const content = (await contentResponse.json()) as {
      readonly decks: readonly {
        readonly id: string;
        readonly doctrineId: string;
        readonly blueprintCardIds: readonly string[];
        readonly signatureActionIds: readonly string[];
      }[];
    };
    const preset = content.decks.find((deck) => deck.id === "open_diffusion_starter");
    if (!preset) {
      throw new Error("测试缺少开放扩散预组");
    }
    const saveResponse = await runtime.app.request("/api/decks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "自定义开放扩散",
        faction: "china",
        doctrineId: preset.doctrineId,
        blueprintCardIds: preset.blueprintCardIds,
        signatureActionIds: preset.signatureActionIds,
      }),
    });
    expect(saveResponse.status).toBe(201);
    const saved = (await saveResponse.json()) as { readonly id: string };
    const createResponse = await runtime.app.request("/api/matches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deckId: saved.id,
        difficulty: "trainee",
      }),
    });
    expect(createResponse.status).toBe(201);
  });

  it("研究地图显示真实初始收藏和节点状态", async () => {
    const runtime = createRuntime();
    const response = await runtime.app.request("/api/research");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly researchData: number;
      readonly collectionCardIds: readonly string[];
      readonly eras: readonly unknown[];
      readonly timeAdvance: {
        readonly currentEraId: string;
        readonly canAdvance: boolean;
      };
      readonly nodes: readonly unknown[];
    };
    expect(body.researchData).toBe(0);
    expect(body.collectionCardIds.length).toBeGreaterThanOrEqual(24);
    expect(body.eras).toHaveLength(8);
    expect(body.timeAdvance.currentEraId).toBe("gpt3");
    expect(body.timeAdvance.canAdvance).toBe(false);
    expect(body.nodes).toHaveLength(48);
    expect(
      body.nodes.filter(
        (node) => typeof node === "object" && node !== null && "unlocked" in node && node.unlocked,
      ).length,
    ).toBeGreaterThan(0);

    const advanceResponse = await runtime.app.request("/api/research/advance", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });
    expect(advanceResponse.status).toBe(409);
  });
});
