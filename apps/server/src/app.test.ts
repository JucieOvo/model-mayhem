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
const testControlToken = "test-control-token-0123456789abcdef";

function createRuntime(
  options: { readonly controlToken?: string; readonly now?: () => number } = {},
): ServerRuntime {
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
    ...(options.now ? { now: options.now } : {}),
    ...(options.controlToken ? { controlToken: options.controlToken } : {}),
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

  it("三种对手难度使用同一真实创建流程", async () => {
    const runtime = createRuntime();
    await runtime.app.request("/api/profile/faction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faction: "china" }),
    });
    for (const difficulty of ["trainee", "standard", "adversarial"] as const) {
      const response = await runtime.app.request("/api/matches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deckId: "open_diffusion_starter",
          difficulty,
        }),
      });
      expect(response.status).toBe(201);
      const created = (await response.json()) as {
        readonly matchId: string;
        readonly seatToken: string;
      };
      const context = runtime.matchService.contextFromToken(created.seatToken);
      expect(context.difficulty).toBe(difficulty);
    }
  });

  it("教程进度只接受真实对局行为推进", async () => {
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
        tutorial: true,
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      readonly matchId: string;
      readonly seatToken: string;
    };
    const initialProgress = (await (await runtime.app.request("/api/tutorial")).json()) as {
      readonly completedSteps: readonly string[];
    };
    expect(initialProgress.completedSteps).toEqual(
      expect.arrayContaining(["faction_selected", "deck_confirmed"]),
    );

    const fakeStep = await runtime.app.request(
      `/api/matches/${created.matchId}/tutorial/progress`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${created.seatToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ stepId: "mulligan_completed" }),
      },
    );
    expect(fakeStep.status).toBe(409);

    const keepAll = runtime.matchService
      .getLegalActions(created.matchId, "player")
      .find((action) => action.kind === "mulligan" && action.label === "保留全部起始手牌");
    if (!keepAll) {
      throw new Error("教程测试缺少保留全部起手牌行动");
    }
    const submitResponse = await runtime.app.request(`/api/matches/${created.matchId}/commands`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${created.seatToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        commandId: "tutorial-mulligan",
        actionId: keepAll.id,
      }),
    });
    expect(submitResponse.status).toBe(200);
    const advanced = await runtime.app.request(
      `/api/matches/${created.matchId}/tutorial/progress`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${created.seatToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ stepId: "mulligan_completed" }),
      },
    );
    expect(advanced.status).toBe(200);
    const progress = (await advanced.json()) as {
      readonly completedSteps: readonly string[];
    };
    expect(progress.completedSteps).toContain("mulligan_completed");
  });

  it("控制接口要求配置令牌并拒绝跨源控制请求", async () => {
    const token = "test-control-token-0123456789abcdef";
    const runtime = createRuntime({ controlToken: token });
    const status = (await (await runtime.app.request("/api/update/status")).json()) as {
      readonly controlTokenRequired: boolean;
    };
    expect(status.controlTokenRequired).toBe(true);

    const missing = await runtime.app.request("/api/diagnostics");
    expect(missing.status).toBe(401);
    const wrong = await runtime.app.request("/api/diagnostics", {
      headers: { "x-modelmayhem-control-token": "wrong-token" },
    });
    expect(wrong.status).toBe(401);
    const accepted = await runtime.app.request("/api/diagnostics", {
      headers: { "x-modelmayhem-control-token": token },
    });
    expect(accepted.status).toBe(200);
    const acceptedBody = (await accepted.json()) as Record<string, unknown>;
    expect(acceptedBody).toMatchObject({
      dataDirectoryConfigured: false,
      agentRuntimeDirectoryConfigured: false,
      logDirectoryConfigured: false,
    });
    expect(acceptedBody).not.toHaveProperty("dataDirectory");
    expect(acceptedBody).not.toHaveProperty("agentRuntimeDirectory");
    expect(acceptedBody).not.toHaveProperty("logDirectory");

    const factionResponse = await runtime.app.request("/api/profile/faction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faction: "china" }),
    });
    expect(factionResponse.status).toBe(200);
    const created = runtime.matchService.createMatch({
      deckId: "open_diffusion_starter",
      difficulty: "trainee",
    });
    const resumeMissing = await runtime.app.request(`/api/matches/${created.matchId}/resume`, {
      method: "POST",
    });
    expect(resumeMissing.status).toBe(401);
    const resumeAccepted = await runtime.app.request(`/api/matches/${created.matchId}/resume`, {
      method: "POST",
      headers: { "x-modelmayhem-control-token": token },
    });
    expect(resumeAccepted.status).toBe(200);

    const loopbackRuntime = createRuntime();
    const crossOrigin = await loopbackRuntime.app.request("/api/diagnostics", {
      headers: {
        host: "127.0.0.1:3210",
        origin: "https://example.invalid",
      },
    });
    expect(crossOrigin.status).toBe(403);

    const rebound = await loopbackRuntime.app.request("/api/diagnostics", {
      headers: {
        host: "evil.example",
        origin: "http://evil.example",
      },
    });
    expect(rebound.status).toBe(403);
  });

  it("恢复对局会撤销旧座位令牌", async () => {
    const runtime = createRuntime({ controlToken: testControlToken });
    await runtime.app.request("/api/profile/faction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faction: "china" }),
    });
    const created = runtime.matchService.createMatch({
      deckId: "open_diffusion_starter",
      difficulty: "trainee",
    });

    const resume = await runtime.app.request(`/api/matches/${created.matchId}/resume`, {
      method: "POST",
      headers: {
        host: "127.0.0.1:3210",
        "x-modelmayhem-control-token": testControlToken,
      },
    });
    expect(resume.status).toBe(200);
    const resumed = (await resume.json()) as { readonly seatToken: string };
    expect(resumed.seatToken).not.toBe(created.seatToken);

    const oldToken = await runtime.app.request(`/api/matches/${created.matchId}`, {
      headers: {
        authorization: `Bearer ${created.seatToken}`,
      },
    });
    expect(oldToken.status).toBe(401);

    const newToken = await runtime.app.request(`/api/matches/${created.matchId}`, {
      headers: {
        authorization: `Bearer ${resumed.seatToken}`,
      },
    });
    expect(newToken.status).toBe(200);
  });

  it("服务重建后仍能从持久化对局恢复并重新签发令牌", async () => {
    const directory = mkdtempSync(join(tmpdir(), "model-mayhem-restart-"));
    directories.push(directory);
    const databasePath = join(directory, "server.sqlite");
    const content = loadContentPack();
    const firstPersistence = openPersistence(databasePath);
    const firstRuntime = createServerRuntime({
      content,
      persistence: firstPersistence,
      store: new PersistenceStore(firstPersistence.db),
      profileId: "local",
      seedFactory: () => 9,
      controlToken: testControlToken,
    });
    await firstRuntime.app.request("/api/profile/faction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faction: "china" }),
    });
    const created = firstRuntime.matchService.createMatch({
      deckId: "open_diffusion_starter",
      difficulty: "trainee",
    });
    await firstRuntime.close();

    const secondPersistence = openPersistence(databasePath);
    const secondRuntime = createServerRuntime({
      content,
      persistence: secondPersistence,
      store: new PersistenceStore(secondPersistence.db),
      profileId: "local",
      seedFactory: () => 9,
      controlToken: testControlToken,
    });
    runtimes.push(secondRuntime);

    const oldToken = await secondRuntime.app.request(`/api/matches/${created.matchId}`, {
      headers: {
        authorization: `Bearer ${created.seatToken}`,
      },
    });
    expect(oldToken.status).toBe(401);

    const resumed = await secondRuntime.app.request(`/api/matches/${created.matchId}/resume`, {
      method: "POST",
      headers: {
        host: "127.0.0.1:3210",
        "x-modelmayhem-control-token": testControlToken,
      },
    });
    expect(resumed.status).toBe(200);
    const summary = (await resumed.json()) as {
      readonly matchId: string;
      readonly seatToken: string;
    };
    expect(summary.matchId).toBe(created.matchId);
    expect(summary.seatToken).not.toBe(created.seatToken);

    const recovered = await secondRuntime.app.request(`/api/matches/${created.matchId}`, {
      headers: {
        authorization: `Bearer ${summary.seatToken}`,
      },
    });
    expect(recovered.status).toBe(200);
  });

  it("模拟与回放不泄露对手隐藏信息", async () => {
    const runtime = createRuntime();
    await runtime.app.request("/api/profile/faction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faction: "china" }),
    });
    const created = runtime.matchService.createMatch({
      deckId: "open_diffusion_starter",
      difficulty: "trainee",
    });
    const action = runtime.matchService.getLegalActions(created.matchId, "player")[0];
    if (!action) {
      throw new Error("模拟测试缺少玩家合法行动");
    }

    const simulate = await runtime.app.request(`/api/matches/${created.matchId}/simulate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${created.seatToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ actionId: action.id }),
    });
    expect(simulate.status).toBe(200);
    const simulation = (await simulate.json()) as {
      readonly state?: unknown;
      readonly view: {
        readonly opponent: Readonly<Record<string, unknown>>;
      };
    };
    expect(simulation.state).toBeUndefined();
    expect(simulation.view.opponent).not.toHaveProperty("blueprintHand");
    expect(simulation.view.opponent).not.toHaveProperty("actionHand");
    expect(simulation.view.opponent).not.toHaveProperty("blueprintDeck");

    const replay = (await (
      await runtime.app.request(`/api/matches/${created.matchId}/replay`, {
        headers: {
          authorization: `Bearer ${created.seatToken}`,
        },
      })
    ).json()) as {
      readonly events: readonly {
        readonly actorSeatId: string;
        readonly type: string;
      }[];
    };
    const privateTypes = new Set([
      "blueprint_drawn",
      "blueprint_pity_triggered",
      "blueprint_discarded",
      "action_drawn",
      "action_discarded",
      "draw_skipped",
      "tech_check_started",
      "tech_check_resolved",
    ]);
    expect(
      replay.events.some((event) => event.actorSeatId === "agent" && privateTypes.has(event.type)),
    ).toBe(false);
  });

  it("Agent 座位不能通过回放接口读取事件流", async () => {
    const runtime = createRuntime();
    await runtime.app.request("/api/profile/faction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faction: "china" }),
    });
    const created = runtime.matchService.createMatch({
      deckId: "open_diffusion_starter",
      difficulty: "trainee",
    });
    const entry = (
      runtime.matchService as unknown as {
        readonly matches: ReadonlyMap<
          string,
          {
            readonly tokens: ReadonlyMap<string, string>;
          }
        >;
      }
    ).matches.get(created.matchId);
    const agentToken = [...(entry?.tokens ?? [])].find(([, seatId]) => seatId === "agent")?.[0];
    if (!agentToken) {
      throw new Error("测试缺少 Agent 座位令牌");
    }

    const response = await runtime.app.request(`/api/matches/${created.matchId}/replay`, {
      headers: {
        authorization: `Bearer ${agentToken}`,
      },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: {
        code: "MATCH_PERMISSION_DENIED",
      },
    });

    const eventsResponse = await runtime.app.request(`/api/matches/${created.matchId}/events`, {
      headers: {
        authorization: `Bearer ${agentToken}`,
      },
    });
    const eventsStatus = eventsResponse.status;
    await eventsResponse.body?.cancel();
    expect(eventsStatus).toBe(403);
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

  it("畸形 JSON 请求返回 400 而不是 500", async () => {
    const runtime = createRuntime();
    const response = await runtime.app.request("/api/profile/faction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { readonly error: { readonly code: string } };
    expect(body.error.code).toBe("INVALID_JSON");
  });

  it("控制请求拒绝代理头并拒绝无法确认来源的调用", async () => {
    const runtime = createRuntime();
    const proxied = await runtime.app.request("/api/diagnostics", {
      headers: {
        host: "127.0.0.1:3210",
        "x-forwarded-for": "127.0.0.1",
      },
    });
    expect(proxied.status).toBe(403);
    const proxiedBody = (await proxied.json()) as {
      readonly error: { readonly code: string };
    };
    expect(proxiedBody.error.code).toBe("CONTROL_PROXY_REJECTED");

    const unknownSource = await runtime.app.request("/api/diagnostics", {
      headers: { host: "127.0.0.1:3210" },
    });
    expect(unknownSource.status).toBe(403);
    const unknownBody = (await unknownSource.json()) as {
      readonly error: { readonly code: string };
    };
    expect(unknownBody.error.code).toBe("CONTROL_TOKEN_REQUIRED");
  });

  it("重复 commandId 不会重复推进对局", async () => {
    const runtime = createRuntime();
    await runtime.app.request("/api/profile/faction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faction: "china" }),
    });
    const created = runtime.matchService.createMatch({
      deckId: "open_diffusion_starter",
      difficulty: "trainee",
    });
    const keepAll = runtime.matchService
      .getLegalActions(created.matchId, "player")
      .find((action) => action.kind === "mulligan" && action.label === "保留全部起始手牌");
    if (!keepAll) {
      throw new Error("测试缺少保留全部起手牌行动");
    }
    const first = runtime.matchService.submitCommand(
      created.matchId,
      "player",
      "duplicate-command",
      { actionId: keepAll.id },
    );
    expect(first.accepted).toBe(true);
    expect(first.events).toHaveLength(1);

    const replayBefore = runtime.matchService.getReplay(created.matchId, "player") as {
      readonly events: readonly unknown[];
    };
    const duplicate = runtime.matchService.submitCommand(
      created.matchId,
      "player",
      "duplicate-command",
      { actionId: keepAll.id },
    );
    expect(duplicate.accepted).toBe(true);
    const replayAfter = runtime.matchService.getReplay(created.matchId, "player") as {
      readonly events: readonly unknown[];
    };
    expect(replayAfter.events).toHaveLength(replayBefore.events.length);
  });

  it("技术检定到达服务端截止时间后自动按答错结算", async () => {
    const content = loadContentPack();
    const clock = { value: Date.parse("2026-09-13T00:00:00.000Z") };
    const runtime = createRuntime({ now: () => clock.value });
    await runtime.app.request("/api/profile/faction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faction: "china" }),
    });
    const created = runtime.matchService.createMatch({
      deckId: "open_diffusion_starter",
      difficulty: "trainee",
    });
    for (const seatId of ["player", "agent"] as const) {
      const keepAll = runtime.matchService
        .getLegalActions(created.matchId, seatId)
        .find((action) => action.kind === "mulligan" && action.label === "保留全部起始手牌");
      if (!keepAll) {
        throw new Error(`测试缺少 ${seatId} 的保留全部起手牌行动`);
      }
      const result = runtime.matchService.submitCommand(
        created.matchId,
        seatId,
        `mulligan-${seatId}`,
        { actionId: keepAll.id },
      );
      expect(result.accepted).toBe(true);
    }

    runtime.matchService.applySandboxMutation(created.matchId, "player", (state) => {
      state.activeSeatId = "player";
      const player = state.players.player;
      if (!player) {
        throw new Error("测试状态缺少玩家座位");
      }
      player.compute = 9;
      player.actionHand.push({ id: "timeout-signature", cardId: "open_weight_release" });
    });
    const pending = runtime.matchService.submitCommand(
      created.matchId,
      "player",
      "play-timeout-signature",
      {
        command: { kind: "play_action", actionInstanceId: "timeout-signature" },
      },
    );
    expect(pending.accepted).toBe(true);
    const pendingView = runtime.matchService.getView(created.matchId, "player");
    expect(pendingView.pendingTechCheck).not.toBeNull();
    expect(pendingView.pendingTechCheck?.deadlineAt).toBe(
      new Date(clock.value + content.balance.techCheckSeconds * 1000).toISOString(),
    );

    clock.value += content.balance.techCheckSeconds * 1000 + 1;
    const settled = runtime.matchService.getView(created.matchId, "player");
    expect(settled.pendingTechCheck).toBeNull();
    expect(settled.me.influence).toBe(1);

    const lateAnswer = runtime.matchService.submitCommand(
      created.matchId,
      "player",
      "late-answer",
      { command: { kind: "resolve_tech_check", optionId: "a" } },
    );
    expect(lateAnswer.accepted).toBe(false);

    const replay = runtime.matchService.getReplay(created.matchId, "player") as {
      readonly events: readonly {
        readonly type: string;
        readonly payload: { readonly timedOut?: boolean; readonly optionId?: string | null };
      }[];
    };
    const resolved = replay.events.find((event) => event.type === "tech_check_resolved");
    expect(resolved?.payload).toMatchObject({
      optionId: null,
      correct: false,
      timedOut: true,
    });
  });
});
