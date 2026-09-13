/**
 * Hono 对局服务应用。
 *
 * 作者：JucieOvo
 *
 * 同一个服务实例同时暴露 REST、SSE 与标准 MCP。所有入口共享工具后端、座位令牌、
 * 规则核心和持久化仓储。
 */

import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import type { ContentUpdater } from "@modelmayhem/content-updater";
import {
  CreateMatchRequestSchema,
  SandboxCommandSchema,
  SaveDeckRequestSchema,
  SetProfileFactionRequestSchema,
  SubmitCommandRequestSchema,
  TutorialDismissRequestSchema,
  TutorialMatchAdvanceRequestSchema,
  UnlockResearchRequestSchema,
} from "@modelmayhem/contracts";
import { createToolGateway, type ToolPermission } from "@modelmayhem/game-tools";
import type { McpHttpHandler } from "@modelmayhem/mcp-binding";
import { createModelMayhemMcpHandler } from "@modelmayhem/mcp-binding";
import type { ContentPack } from "@modelmayhem/model-mayhem-content";
import { ModelMayhemCommandSchema } from "@modelmayhem/model-mayhem-rules";
import type { PersistenceConnection, PersistenceStore } from "@modelmayhem/persistence";
import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import pino from "pino";
import { ServiceError } from "./errors";
import type { LocalLogger } from "./logging";
import type { AgentRunner } from "./match-service";
import { MatchService } from "./match-service";
import { isDeepSeekKeyConfigured, redactSecrets, safeError } from "./redaction";
import { SandboxService } from "./sandbox-service";
import { createServerToolBackend } from "./tool-backend";

export interface ServerRuntime {
  readonly app: Hono;
  readonly matchService: MatchService;
  readonly mcpHandler: McpHttpHandler;
  close(): Promise<void>;
}

export interface CreateServerRuntimeOptions {
  readonly content: ContentPack;
  readonly persistence: PersistenceConnection;
  readonly store: PersistenceStore;
  readonly profileId: string;
  readonly seedFactory?: () => number;
  readonly now?: () => number;
  readonly agentRunner?: AgentRunner;
  readonly logger?: pino.Logger;
  readonly localLogger?: LocalLogger;
  readonly appVersion?: string;
  readonly dataDirectory?: string;
  readonly agentRuntimeDirectory?: string;
  readonly updateUpdater?: ContentUpdater;
  readonly controlToken?: string;
  readonly sandboxService?: SandboxService;
  readonly sandboxConfig?: {
    readonly enabled: boolean;
    readonly remoteEnabled: boolean;
    readonly profileId: string;
  };
  readonly webDirectory?: string;
  readonly corsOrigins?: readonly string[];
}

function bearerToken(authorization: string | null): string {
  if (!authorization?.startsWith("Bearer ")) {
    throw new ServiceError(401, "MISSING_SEAT_TOKEN", "缺少座位令牌");
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (token.length === 0) {
    throw new ServiceError(401, "MISSING_SEAT_TOKEN", "座位令牌为空");
  }
  return token;
}

/** 读取 JSON 请求正文，并把语法错误统一映射为可处理的客户端错误。 */
async function readJsonBody(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ServiceError(400, "INVALID_JSON", "请求正文不是合法 JSON");
    }
    throw error;
  }
}

/** 创建完整服务运行时。 */
export function createServerRuntime(options: CreateServerRuntimeOptions): ServerRuntime {
  const logger =
    options.logger ??
    options.localLogger?.logger ??
    pino({
      level: process.env.LOG_LEVEL ?? "info",
      redact: {
        paths: [
          "apiKey",
          "authorization",
          "seatToken",
          "*.apiKey",
          "*.authorization",
          "*.seatToken",
          "req.headers.authorization",
        ],
        censor: "[REDACTED_SECRET]",
      },
    });
  const matchService = new MatchService({
    content: options.content,
    store: options.store,
    profileId: options.profileId,
    ...(options.seedFactory ? { seedFactory: options.seedFactory } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.agentRunner ? { agentRunner: options.agentRunner } : {}),
  });
  const realBackend = createServerToolBackend({
    content: options.content,
    store: options.store,
    matchService,
  });
  const gateway = createToolGateway(realBackend, ModelMayhemCommandSchema);
  matchService.setGateway(gateway);
  matchService.initializeProfile();
  const sandboxService =
    options.sandboxService ??
    (options.sandboxConfig?.enabled
      ? new SandboxService({
          enabled: options.sandboxConfig.enabled,
          remoteEnabled: options.sandboxConfig.remoteEnabled,
          profileId: options.sandboxConfig.profileId,
          content: options.content,
          store: options.store,
          matchService,
        })
      : undefined);

  const mcpHandler = createModelMayhemMcpHandler({
    gateway,
    serverName: "model-mayhem",
    serverVersion: options.content.manifest.version,
    contextFactory: (requestContext) => {
      const authorization = requestContext.requestInfo?.headers.get("authorization") ?? null;
      return matchService.contextFromToken(bearerToken(authorization));
    },
  });

  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: [...(options.corsOrigins ?? ["http://127.0.0.1:5173", "http://localhost:5173"])],
      allowHeaders: ["Authorization", "Content-Type", "X-ModelMayhem-Control-Token"],
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    }),
  );

  app.get("/api/health", (context) =>
    context.json({
      status: "ok",
      rulesetId: "model-mayhem",
      rulesetVersion: options.content.balance.version,
      contentVersion: options.content.manifest.version,
    }),
  );

  app.get("/api/rules", (context) =>
    context.json({
      rulesetId: "model-mayhem",
      rulesetVersion: options.content.balance.version,
      contentVersion: options.content.manifest.version,
      balance: options.content.balance,
    }),
  );

  app.get("/api/content", (context) =>
    context.json({
      manifest: options.content.manifest,
      balance: options.content.balance,
      doctrines: [...options.content.doctrines.values()],
      decks: [...options.content.decks.values()],
      cards: [...options.content.cards.values()],
    }),
  );

  app.get("/api/update/status", async (context) => {
    if (!options.updateUpdater) {
      return context.json({
        enabled: false,
        repository: null,
        contentBranch: null,
        balanceBranch: null,
        channel: "stable",
        checkOnStart: false,
        autoInstall: false,
        controlTokenRequired: options.controlToken !== undefined,
        active: null,
        pendingContentCommit: null,
        pendingBalanceCommit: null,
        pendingContentVersion: null,
        pendingBalanceVersion: null,
        rollbackAvailable: false,
        restartRequired: false,
        integrity: "unknown",
        message: "更新器未启用",
      });
    }
    return context.json({
      ...(await options.updateUpdater.getStatus()),
      controlTokenRequired: options.controlToken !== undefined,
    });
  });

  app.post("/api/update/check", async (context) => {
    authorizeControlRequest(context, options.controlToken);
    if (!options.updateUpdater) {
      throw new ServiceError(404, "UPDATE_DISABLED", "更新器未启用");
    }
    const result = await options.updateUpdater.checkForUpdate();
    logger.info({ category: "update", result }, "更新检查完成");
    return context.json(result);
  });

  app.post("/api/update/install", async (context) => {
    authorizeControlRequest(context, options.controlToken);
    if (!options.updateUpdater) {
      throw new ServiceError(404, "UPDATE_DISABLED", "更新器未启用");
    }
    const result = await options.updateUpdater.installPending();
    logger.info({ category: "update", result }, "更新安装完成");
    return context.json(result);
  });

  app.post("/api/update/rollback", async (context) => {
    authorizeControlRequest(context, options.controlToken);
    if (!options.updateUpdater) {
      throw new ServiceError(404, "UPDATE_DISABLED", "更新器未启用");
    }
    const result = await options.updateUpdater.rollback();
    logger.warn({ category: "update", result }, "系统内容已回滚");
    return context.json(result);
  });

  app.get("/api/sandbox/status", (context) => {
    const sandbox = sandboxService;
    if (!sandbox) {
      throw new ServiceError(404, "SANDBOX_DISABLED", "沙盒模式未启用");
    }
    sandbox.checkAccess(remoteAddress(context));
    return context.json(sandbox.getStatus());
  });

  app.post("/api/sandbox/command", async (context) => {
    const sandbox = sandboxService;
    if (!sandbox) {
      throw new ServiceError(404, "SANDBOX_DISABLED", "沙盒模式未启用");
    }
    const parsed = SandboxCommandSchema.safeParse(await readJsonBody(context));
    if (!parsed.success) {
      throw new ServiceError(422, "INVALID_SANDBOX_COMMAND", "沙盒命令无效", parsed.error.issues);
    }
    const result = await sandbox.execute(parsed.data, remoteAddress(context));
    logger.info(
      {
        category: "sandbox",
        command: parsed.data.kind,
        matchId: "matchId" in parsed.data ? parsed.data.matchId : null,
      },
      "沙盒命令执行完成",
    );
    return context.json(result);
  });

  app.post("/api/sandbox/matches", async (context) => {
    const sandbox = sandboxService;
    if (!sandbox) {
      throw new ServiceError(404, "SANDBOX_DISABLED", "沙盒模式未启用");
    }
    const parsed = CreateMatchRequestSchema.safeParse(await readJsonBody(context));
    if (!parsed.success) {
      throw new ServiceError(
        422,
        "INVALID_MATCH_REQUEST",
        "创建沙盒对局请求无效",
        parsed.error.issues,
      );
    }
    return context.json(
      sandbox.createMatch(
        {
          deckId: parsed.data.deckId,
          difficulty: parsed.data.difficulty,
          ...(parsed.data.seed === undefined ? {} : { seed: parsed.data.seed }),
        },
        remoteAddress(context),
      ),
      201,
    );
  });

  app.get("/api/tutorial", (context) =>
    context.json(options.store.getTutorialProgress(options.profileId)),
  );

  app.post("/api/matches/:matchId/tutorial/progress", async (context) => {
    const parsed = TutorialMatchAdvanceRequestSchema.safeParse(await readJsonBody(context));
    if (!parsed.success) {
      throw new ServiceError(
        422,
        "INVALID_TUTORIAL_REQUEST",
        "教程进度请求无效",
        parsed.error.issues,
      );
    }
    const { context: toolContext } = authorizeMatch(
      context.req.header("authorization") ?? null,
      context.req.param("matchId"),
      matchService,
    );
    if (toolContext.actorKind !== "human") {
      throw new ServiceError(403, "TUTORIAL_PLAYER_ONLY", "只有玩家座位可以推进教程");
    }
    const view = matchService.getView(toolContext.matchId, toolContext.seatId);
    const events = options.store.listMatchEvents(toolContext.matchId);
    const hasPlayerEvent = (type: string): boolean =>
      events.some((event) => event.actorSeatId === toolContext.seatId && event.type === type);
    const satisfied =
      (parsed.data.stepId === "mulligan_completed" && view.me.mulliganReady) ||
      (parsed.data.stepId === "organization_deployed" &&
        view.me.anchors.some(
          (anchor) => !anchor.isHomeLab && anchor.organizationCardId !== null,
        )) ||
      (parsed.data.stepId === "asset_deployed" && view.me.assets.length > 0) ||
      (parsed.data.stepId === "action_played" && hasPlayerEvent("action_played")) ||
      (parsed.data.stepId === "benchmark_completed" && hasPlayerEvent("benchmark_resolved"));
    if (!satisfied) {
      throw new ServiceError(409, "TUTORIAL_STEP_NOT_COMPLETED", "教程步骤尚未由真实对局行为完成");
    }
    return context.json(options.store.completeTutorialStep(options.profileId, parsed.data.stepId));
  });

  app.post("/api/tutorial/dismiss", async (context) => {
    const parsed = TutorialDismissRequestSchema.safeParse(await readJsonBody(context));
    if (!parsed.success) {
      throw new ServiceError(
        422,
        "INVALID_TUTORIAL_REQUEST",
        "教程提示请求无效",
        parsed.error.issues,
      );
    }
    return context.json(
      options.store.setTutorialDismissed(options.profileId, parsed.data.dismissed),
    );
  });

  app.get("/api/diagnostics", async (context) => {
    authorizeControlRequest(context, options.controlToken);
    const updateStatus = await options.updateUpdater?.getStatus();
    return context.json({
      appVersion: options.appVersion ?? "0.1.0",
      contentVersion: updateStatus?.active?.contentVersion ?? options.content.manifest.version,
      contentCommit: updateStatus?.active?.contentCommit ?? "local",
      balanceVersion: updateStatus?.active?.balanceVersion ?? options.content.balance.version,
      balanceCommit: updateStatus?.active?.balanceCommit ?? "local",
      dataDirectoryConfigured: options.dataDirectory !== undefined,
      agentRuntimeDirectoryConfigured: options.agentRuntimeDirectory !== undefined,
      logDirectoryConfigured: options.localLogger !== undefined,
      deepSeekKeyConfigured: isDeepSeekKeyConfigured(),
      sandboxEnabled: sandboxService?.isEnabled() ?? false,
      devApiEnabled: sandboxService?.isEnabled() ?? false,
    });
  });

  app.get("/api/diagnostics/export", (context) => {
    authorizeControlRequest(context, options.controlToken);
    const recent = options.localLogger?.getRecent(undefined, 2_000) ?? [];
    context.header(
      "Content-Disposition",
      `attachment; filename="model-mayhem-diagnostics-${Date.now()}.json"`,
    );
    return context.json(
      redactSecrets({
        generatedAt: new Date().toISOString(),
        appVersion: options.appVersion ?? "0.1.0",
        contentVersion: options.content.manifest.version,
        deepSeekKeyConfigured: isDeepSeekKeyConfigured(),
        logs: recent,
      }),
    );
  });

  app.get("/api/cards/:cardId", async (context) => {
    const cardId = context.req.param("cardId");
    const card = await realBackend.inspectCard(cardId);
    return context.json(card);
  });

  app.get("/api/questions/:questionId", (context) => {
    const question = options.content.questions.get(context.req.param("questionId"));
    if (!question) {
      throw new ServiceError(404, "QUESTION_NOT_FOUND", "技术检定题目不存在");
    }
    return context.json({
      id: question.id,
      prompt: question.prompt,
      options: question.options,
    });
  });

  app.get("/api/profile", (context) => {
    const profile = options.store.ensureProfile(options.profileId);
    return context.json({
      profile,
      collectionCardIds: options.store.listCollection(options.profileId),
      deckIds: options.store.listDecks(options.profileId).map((deck) => deck.id),
    });
  });

  app.post("/api/profile/faction", async (context) => {
    const parsed = SetProfileFactionRequestSchema.safeParse(await readJsonBody(context));
    if (!parsed.success) {
      throw new ServiceError(
        422,
        "INVALID_PROFILE_FACTION",
        "财团选择请求无效",
        parsed.error.issues,
      );
    }
    try {
      const profile = options.store.setProfileFaction(options.profileId, parsed.data.faction);
      options.store.completeTutorialStep(options.profileId, "faction_selected");
      return context.json(profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ServiceError(409, "PROFILE_FACTION_REJECTED", message);
    }
  });

  app.get("/api/research", async (context) => {
    return context.json(
      await realBackend.getResearchMap({
        matchId: "",
        seatId: "local",
        actorKind: "human",
        profileId: options.profileId,
        permissions: ["progress"],
      }),
    );
  });

  app.post("/api/research/unlock", async (context) => {
    const body = UnlockResearchRequestSchema.safeParse(await readJsonBody(context));
    if (!body.success) {
      throw new ServiceError(
        422,
        "INVALID_RESEARCH_REQUEST",
        "研究解锁请求无效",
        body.error.issues,
      );
    }
    const node = options.content.researchNodes.get(body.data.nodeId);
    if (!node) {
      throw new ServiceError(404, "RESEARCH_NODE_NOT_FOUND", "研究节点不存在");
    }
    const profile = options.store.ensureProfile(options.profileId);
    const currentEra = options.content.eras.get(profile.currentEraId);
    const nodeEra = node.stageId ? options.content.eras.get(node.stageId) : undefined;
    if (!currentEra || (nodeEra && nodeEra.order > currentEra.order)) {
      throw new ServiceError(409, "RESEARCH_ERA_LOCKED", `研究节点 ${node.id} 尚未随时代解锁`);
    }
    try {
      options.store.unlockResearchNode({
        profileId: options.profileId,
        nodeId: node.id,
        cost: node.cost,
        ...(node.prerequisiteId ? { prerequisiteId: node.prerequisiteId } : {}),
        ...(node.prerequisiteIds ? { prerequisiteIds: node.prerequisiteIds } : {}),
        prerequisiteMode: node.prerequisiteMode,
        rewardCardIds: node.rewardCardIds,
      });
      options.store.completeTutorialStep(options.profileId, "research_node_unlocked");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ServiceError(409, "RESEARCH_UNLOCK_REJECTED", message);
    }
    return context.json(
      await realBackend.getResearchMap({
        matchId: "",
        seatId: "local",
        actorKind: "human",
        profileId: options.profileId,
        permissions: ["progress"],
      }),
    );
  });

  app.post("/api/research/advance", async (context) => {
    const toolContext = {
      matchId: "",
      seatId: "local",
      actorKind: "human" as const,
      profileId: options.profileId,
      permissions: ["progress"] as const,
    };
    const before = (await realBackend.getResearchMap(toolContext)) as {
      readonly timeAdvance: {
        readonly currentEraId: string;
        readonly nextEraId?: string;
        readonly canAdvance: boolean;
      };
    };
    if (!before.timeAdvance.canAdvance || !before.timeAdvance.nextEraId) {
      throw new ServiceError(409, "ERA_ADVANCE_NOT_READY", "当前时代尚未满足时间推进条件");
    }
    try {
      options.store.advanceEra({
        profileId: options.profileId,
        expectedEraId: before.timeAdvance.currentEraId,
        nextEraId: before.timeAdvance.nextEraId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ServiceError(409, "ERA_ADVANCE_REJECTED", message);
    }
    return context.json(await realBackend.getResearchMap(toolContext));
  });

  app.get("/api/decks", (context) =>
    context.json({
      presetDecks: [...options.content.decks.values()],
      savedDecks: options.store.listDecks(options.profileId),
    }),
  );

  app.post("/api/decks", async (context) => {
    const parsed = SaveDeckRequestSchema.safeParse(await readJsonBody(context));
    if (!parsed.success) {
      throw new ServiceError(422, "INVALID_DECK_REQUEST", "牌组请求无效", parsed.error.issues);
    }
    const deck = await realBackend.updateDeck(
      {
        matchId: "",
        seatId: "local",
        actorKind: "human",
        profileId: options.profileId,
        permissions: ["progress"],
      },
      parsed.data,
    );
    return context.json(deck, 201);
  });

  app.post("/api/matches", async (context) => {
    const parsed = CreateMatchRequestSchema.safeParse(await readJsonBody(context));
    if (!parsed.success) {
      throw new ServiceError(422, "INVALID_MATCH_REQUEST", "创建对局请求无效", parsed.error.issues);
    }
    const created = matchService.createMatch({
      deckId: parsed.data.deckId,
      difficulty: parsed.data.difficulty,
      ...(parsed.data.seed === undefined ? {} : { seed: parsed.data.seed }),
    });
    if (parsed.data.tutorial) {
      options.store.completeTutorialStep(options.profileId, "faction_selected");
      options.store.completeTutorialStep(options.profileId, "deck_confirmed");
    }
    logger.info(
      { category: "match", matchId: created.matchId, difficulty: parsed.data.difficulty },
      "对局创建完成",
    );
    return context.json(created, 201);
  });

  app.post("/api/matches/:matchId/resume", (context) => {
    authorizeControlRequest(context, options.controlToken);
    const summary = matchService.resumePlayerMatch(context.req.param("matchId"));
    return context.json({
      ...summary,
      agent: matchService.getAgentStatus(summary.matchId),
    });
  });

  app.get("/api/matches/:matchId", (context) => {
    const { context: toolContext } = authorizeMatch(
      context.req.header("authorization") ?? null,
      context.req.param("matchId"),
      matchService,
    );
    return context.json({
      view: matchService.getView(toolContext.matchId, toolContext.seatId),
      agent: matchService.getAgentStatus(toolContext.matchId),
    });
  });

  app.get("/api/matches/:matchId/private", (context) => {
    const { context: toolContext } = authorizeMatch(
      context.req.header("authorization") ?? null,
      context.req.param("matchId"),
      matchService,
    );
    return context.json(matchService.getView(toolContext.matchId, toolContext.seatId).me);
  });

  app.get("/api/matches/:matchId/legal-actions", (context) => {
    const { context: toolContext } = authorizeMatch(
      context.req.header("authorization") ?? null,
      context.req.param("matchId"),
      matchService,
    );
    return context.json(matchService.getLegalActions(toolContext.matchId, toolContext.seatId));
  });

  app.post("/api/matches/:matchId/simulate", async (context) => {
    const { context: toolContext } = authorizeMatch(
      context.req.header("authorization") ?? null,
      context.req.param("matchId"),
      matchService,
    );
    const rawBody = await readJsonBody(context);
    if (typeof rawBody !== "object" || rawBody === null) {
      throw new ServiceError(422, "INVALID_SIMULATION_REQUEST", "模拟请求结构无效");
    }
    const body = rawBody as {
      readonly actionId?: string;
      readonly command?: unknown;
    };
    return context.json(matchService.simulate(toolContext.matchId, toolContext.seatId, body));
  });

  app.get("/api/matches/:matchId/turn-context", async (context) => {
    const { context: toolContext } = authorizeMatch(
      context.req.header("authorization") ?? null,
      context.req.param("matchId"),
      matchService,
    );
    return context.json(await realBackend.getTurnContext(toolContext));
  });

  app.post("/api/matches/:matchId/commands", async (context) => {
    const { context: toolContext } = authorizeMatch(
      context.req.header("authorization") ?? null,
      context.req.param("matchId"),
      matchService,
    );
    const parsed = SubmitCommandRequestSchema.safeParse(await readJsonBody(context));
    if (!parsed.success) {
      throw new ServiceError(422, "INVALID_COMMAND_REQUEST", "命令请求无效", parsed.error.issues);
    }
    const result = matchService.submitCommand(
      toolContext.matchId,
      toolContext.seatId,
      parsed.data.commandId,
      {
        ...(parsed.data.actionId
          ? { actionId: parsed.data.actionId }
          : { command: parsed.data.command }),
      },
    );
    logger.info(
      {
        category: "match",
        matchId: toolContext.matchId,
        seatId: toolContext.seatId,
        commandId: parsed.data.commandId,
        accepted: result.accepted,
        eventCount: result.events.length,
      },
      "玩家命令提交完成",
    );
    return context.json(result);
  });

  app.get("/api/matches/:matchId/wait", async (context) => {
    const { context: toolContext } = authorizeMatch(
      context.req.header("authorization") ?? null,
      context.req.param("matchId"),
      matchService,
    );
    const timeoutMs = Number(context.req.query("timeoutMs") ?? "30000");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 300_000) {
      throw new ServiceError(422, "INVALID_TIMEOUT", "等待时间无效");
    }
    return context.json(
      await matchService.waitForTurn(toolContext.matchId, toolContext.seatId, timeoutMs),
    );
  });

  app.get("/api/matches/:matchId/replay", (context) => {
    const { context: toolContext } = authorizeMatch(
      context.req.header("authorization") ?? null,
      context.req.param("matchId"),
      matchService,
      "replay",
    );
    return context.json(matchService.getReplay(toolContext.matchId, toolContext.seatId));
  });

  app.get("/api/matches/:matchId/events", async (context) => {
    const { context: toolContext } = authorizeMatch(
      context.req.header("authorization") ?? null,
      context.req.param("matchId"),
      matchService,
      "replay",
    );
    return streamSSE(context, async (stream) => {
      let unsubscribe = () => {};
      const closed = new Promise<void>((resolve) => {
        unsubscribe = matchService.subscribe(toolContext.matchId, toolContext.seatId, (event) => {
          void stream.writeSSE({
            id: String(event.sequence),
            event: event.type,
            data: JSON.stringify(event.payload),
          });
        });
        stream.onAbort(() => {
          unsubscribe();
          resolve();
        });
      });
      await closed;
      unsubscribe();
    });
  });

  app.all("/mcp", async (context) => mcpHandler.fetch(context.req.raw));

  if (options.webDirectory && existsSync(options.webDirectory)) {
    app.use("*", serveStatic({ root: options.webDirectory }));
    const indexFallback = serveStatic({
      root: options.webDirectory,
      rewriteRequestPath: () => "index.html",
    });
    app.get("*", async (context, next) => {
      if (context.req.path.startsWith("/api/") || context.req.path === "/mcp") {
        return next();
      }
      return indexFallback(context, next);
    });
  }

  app.onError((error, context) => {
    if (error instanceof ServiceError) {
      return context.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
          },
        },
        error.status,
      );
    }
    logger.error(
      {
        category: "server",
        error: safeError(error),
        path: context.req.path,
        method: context.req.method,
      },
      "未处理的服务端异常",
    );
    return context.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "服务端发生内部错误",
        },
      },
      500,
    );
  });

  app.notFound((context) =>
    context.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "接口不存在",
        },
      },
      404,
    ),
  );

  return {
    app,
    matchService,
    mcpHandler,
    async close() {
      await mcpHandler.close();
      options.persistence.close();
    },
  };
}

function authorizeMatch(
  authorization: string | null,
  matchId: string,
  matchService: MatchService,
  requiredPermission?: ToolPermission,
): { readonly context: ReturnType<MatchService["contextFromToken"]> } {
  const toolContext = matchService.contextFromToken(bearerToken(authorization));
  if (toolContext.matchId !== matchId) {
    throw new ServiceError(403, "MATCH_ACCESS_DENIED", "座位令牌不能访问该对局");
  }
  if (requiredPermission && !toolContext.permissions.includes(requiredPermission)) {
    throw new ServiceError(403, "MATCH_PERMISSION_DENIED", "当前座位没有访问该资源的权限");
  }
  return { context: toolContext };
}

function secureTokenMatches(expected: string, provided: string | undefined): boolean {
  if (!provided) {
    return false;
  }
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  return (
    expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
  );
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) {
    return false;
  }
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" || normalized.startsWith("127.") || normalized.startsWith("::ffff:127.")
  );
}

function hasProxyHeaders(context: Context): boolean {
  return ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip"].some((header) =>
    Boolean(context.req.header(header)),
  );
}

function hasMatchingOrigin(context: Context): boolean {
  const origin = context.req.header("origin");
  if (!origin) {
    return true;
  }
  const host = context.req.header("host");
  if (!host) {
    return false;
  }
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function hasLoopbackHost(context: Context): boolean {
  const host = context.req.header("host");
  if (!host) {
    return false;
  }
  try {
    const hostname = new URL(`http://${host}`).hostname;
    return (
      hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname === "[::1]" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
}

function authorizeControlRequest(context: Context, configuredToken: string | undefined): void {
  const providedToken = context.req.header("x-modelmayhem-control-token");
  if (configuredToken !== undefined) {
    if (!secureTokenMatches(configuredToken, providedToken)) {
      throw new ServiceError(401, "CONTROL_TOKEN_REQUIRED", "控制令牌缺失或无效");
    }
    return;
  }
  if (hasProxyHeaders(context)) {
    throw new ServiceError(
      403,
      "CONTROL_PROXY_REJECTED",
      "控制请求经过反向代理时必须配置 MODELMAYHEM_CONTROL_TOKEN",
    );
  }
  if (!isLoopbackAddress(remoteAddress(context))) {
    throw new ServiceError(
      403,
      "CONTROL_TOKEN_REQUIRED",
      "无法确认本机来源或请求来自非回环地址，必须配置 MODELMAYHEM_CONTROL_TOKEN",
    );
  }
  if (!hasLoopbackHost(context)) {
    throw new ServiceError(403, "CONTROL_ORIGIN_REJECTED", "控制请求主机不是回环地址");
  }
  if (!hasMatchingOrigin(context)) {
    throw new ServiceError(403, "CONTROL_ORIGIN_REJECTED", "控制请求来源与当前服务不一致");
  }
}

function remoteAddress(context: Context): string | undefined {
  try {
    return getConnInfo(context).remote.address;
  } catch {
    return undefined;
  }
}
