/**
 * 对局、成长和回放服务。
 *
 * 作者：JucieOvo
 *
 * 服务端是规则状态的唯一写入口。它负责座位令牌、快照恢复、命令提交、事件持久化、
 * 研究结算和 Agent 调度；浏览器和 Agent 都只能通过这里访问规则。
 */

import { randomBytes, randomInt } from "node:crypto";
import { EventEmitter } from "node:events";
import { opposingConsortiumFaction } from "@modelmayhem/contracts";
import type { CommandActor, GameEvent, GameSessionSnapshot } from "@modelmayhem/game-kernel";
import { GameRuntime } from "@modelmayhem/game-kernel";
import type {
  ActionReference,
  AgentDifficulty,
  ToolContext,
  ToolGateway,
} from "@modelmayhem/game-tools";
import type { ContentPack, DeckConfig } from "@modelmayhem/model-mayhem-content";
import type {
  LegalAction,
  MatchState,
  ModelMayhemCommand,
  ModelMayhemDefinitionOptions,
  ModelMayhemEventPayload,
  ModelMayhemEventType,
  ModelMayhemView,
} from "@modelmayhem/model-mayhem-rules";
import {
  createModelMayhemDefinition,
  generateLegalActions,
  ModelMayhemCommandSchema,
  projectModelMayhemView,
} from "@modelmayhem/model-mayhem-rules";
import type { PersistenceStore } from "@modelmayhem/persistence";
import { simulateModelMayhemCommand } from "@modelmayhem/simulator";
import { ulid } from "ulid";
import { buildRandomAgentDeck } from "./agent-deck";
import { ServiceError } from "./errors";
import { isDeepSeekKeyConfigured } from "./redaction";

export interface AgentRunner {
  readonly id: string;
  run(input: {
    readonly matchId: string;
    readonly context: ToolContext;
    readonly gateway: ToolGateway;
    readonly difficulty: AgentDifficulty;
    readonly onAudit?: (record: {
      readonly eventType: string;
      readonly toolName?: string;
      readonly input?: unknown;
      readonly output?: unknown;
      readonly errorMessage?: string;
      readonly latencyMs?: number;
    }) => void;
  }): Promise<void>;
  disposeMatch?(matchId: string): void;
}

export interface MatchServiceOptions {
  readonly content: ContentPack;
  readonly store: PersistenceStore;
  readonly profileId: string;
  readonly seedFactory?: () => number;
  readonly now?: () => number;
  readonly agentRunner?: AgentRunner;
}

interface CachedCommandResult {
  readonly accepted: boolean;
  readonly events: readonly GameEvent<ModelMayhemEventType, ModelMayhemEventPayload>[];
  readonly violation?: {
    readonly code: string;
    readonly message: string;
  };
}

interface MatchEntry {
  runtime: GameRuntime<
    MatchState,
    ModelMayhemCommand,
    ModelMayhemEventType,
    ModelMayhemEventPayload,
    ModelMayhemView
  >;
  readonly profileId: string;
  readonly difficulty: AgentDifficulty;
  readonly tokens: Map<string, string>;
  readonly events: EventEmitter;
  readonly processedCommands: Map<string, CachedCommandResult>;
  agentRunInFlight: boolean;
  agentError: string | null;
  researchAwarded: boolean;
}

/** 每个对局保留的幂等结果数量上限，避免长时间对局无限增长。 */
const MAX_CACHED_COMMAND_RESULTS = 256;

export interface MatchSummary {
  readonly matchId: string;
  readonly playerSeatId: string;
  readonly seatToken: string;
  readonly seed: number;
  readonly view: ModelMayhemView;
}

export interface SubmitCommandResult {
  readonly accepted: boolean;
  readonly view: ModelMayhemView;
  readonly events: readonly GameEvent<ModelMayhemEventType, ModelMayhemEventPayload>[];
  readonly violation?: {
    readonly code: string;
    readonly message: string;
  };
}

function createSeatToken(): string {
  return randomBytes(32).toString("base64url");
}

function actorForSeat(seatId: string, kind: "human" | "agent"): CommandActor {
  return { seatId, kind };
}

/**
 * 私有事件只对事件所属座位可见。
 *
 * 抽牌、弃牌和技术检定过程会包含真实牌序或题目信息，SSE、回放和模拟
 * 都不能把这些内容发给对手。公开事件没有座位归属，继续对双方可见。
 */
function isPrivateEventForSeat(
  event: {
    readonly type: string;
    readonly actor?: CommandActor;
    readonly actorSeatId?: string;
    readonly payload?: unknown;
  },
  seatId: string,
): boolean {
  const privateTypes = new Set<string>([
    "blueprint_drawn",
    "blueprint_pity_triggered",
    "blueprint_discarded",
    "action_drawn",
    "action_discarded",
    "draw_skipped",
    "tech_check_started",
    "tech_check_resolved",
  ]);
  if (!privateTypes.has(event.type)) {
    return true;
  }
  const payloadSeatId =
    typeof event.payload === "object" &&
    event.payload !== null &&
    "seatId" in event.payload &&
    typeof event.payload.seatId === "string"
      ? event.payload.seatId
      : undefined;
  const ownerSeatId = event.actorSeatId ?? event.actor?.seatId ?? payloadSeatId;
  return ownerSeatId === seatId;
}

function projectSimulationResult(
  content: ContentPack,
  result: ReturnType<typeof simulateModelMayhemCommand>,
  seatId: string,
  actor: CommandActor,
): unknown {
  return {
    accepted: result.accepted,
    view: projectModelMayhemView(content, result.state, actor),
    events: result.events.filter((event) => isPrivateEventForSeat(event, seatId)),
    ...(result.violation ? { violation: result.violation } : {}),
  };
}

function selectionKey(cardInstanceIds: readonly string[]): string {
  return [...cardInstanceIds].sort((left, right) => left.localeCompare(right)).join("\u0000");
}

/**
 * 压缩 Agent 在调度阶段看到的组合数量。
 *
 * 人类界面仍可逐张选择；Agent 只需要在保留、处理重复牌、处理高费牌和全部调度
 * 之间决策。返回值全部来自真实合法行动，只调整展示标签，不改变命令语义。
 */
function summarizeAgentMulliganActions(
  content: ContentPack,
  view: ModelMayhemView,
  legalActions: readonly LegalAction[],
): readonly LegalAction[] {
  if (view.phase !== "mulligan") {
    return legalActions;
  }
  const mulliganActions = legalActions.filter(
    (action): action is Extract<LegalAction, { kind: "mulligan" }> => action.kind === "mulligan",
  );
  if (mulliganActions.length <= 4) {
    return legalActions;
  }
  const bySelection = new Map(
    mulliganActions.map((action) => [selectionKey(action.cardInstanceIds), action] as const),
  );
  const selected: LegalAction[] = [];
  const selectedKeys = new Set<string>();
  const addSelection = (cardInstanceIds: readonly string[], label: string): void => {
    const key = selectionKey(cardInstanceIds);
    const action = bySelection.get(key);
    if (!action || selectedKeys.has(key)) {
      return;
    }
    selectedKeys.add(key);
    selected.push({ ...action, label });
  };

  addSelection([], "保留全部起始手牌");

  const instancesByCard = new Map<string, string[]>();
  for (const handCard of view.me.blueprintHand) {
    const instances = instancesByCard.get(handCard.cardId) ?? [];
    instances.push(handCard.instanceId);
    instancesByCard.set(handCard.cardId, instances);
  }
  const duplicateInstances = [...instancesByCard.values()].flatMap((instances) =>
    instances.slice(1),
  );
  addSelection(duplicateInstances, "只调度重复的起始牌");

  const highCostInstances = view.me.blueprintHand
    .map((handCard, index) => {
      const card = content.cards.get(handCard.cardId);
      if (!card) {
        throw new Error(`调度手牌引用了不存在卡牌：${handCard.cardId}`);
      }
      return {
        instanceId: handCard.instanceId,
        cost: card.cost.compute + card.cost.capital,
        index,
      };
    })
    .sort((left, right) => right.cost - left.cost || left.index - right.index)
    .slice(0, Math.min(2, view.me.blueprintHand.length))
    .map((entry) => entry.instanceId);
  addSelection(highCostInstances, `调度费用最高的 ${highCostInstances.length} 张`);

  addSelection(
    view.me.blueprintHand.map((handCard) => handCard.instanceId),
    "调度全部起始手牌",
  );
  return selected;
}

/** 对局服务，维护内存运行时并同步真实数据库快照。 */
export class MatchService {
  private readonly matches = new Map<string, MatchEntry>();
  private readonly tokenIndex = new Map<string, string>();
  private readonly seedFactory: () => number;
  private gateway: ToolGateway | undefined;

  constructor(private readonly options: MatchServiceOptions) {
    this.seedFactory = options.seedFactory ?? (() => randomInt(1, 2_147_483_647));
  }

  /** 注入统一工具网关，供内部 Agent 直连。 */
  setGateway(gateway: ToolGateway): void {
    this.gateway = gateway;
  }

  /** 初始化本地档案和初始收藏。 */
  initializeProfile(
    profileId: string = this.options.profileId,
    displayName = "本地玩家",
    kind: "official" | "sandbox" = "official",
  ): void {
    this.options.store.ensureProfile(profileId, displayName, kind);
    const unlockedNodes = new Set(this.options.store.listResearchNodes(profileId));
    const prehistoryNodes = [...this.options.content.researchNodes.values()]
      .filter((node) => node.stageId === "pre_gpt3")
      .sort((left, right) => left.branch.localeCompare(right.branch) || left.depth - right.depth);
    for (const node of prehistoryNodes) {
      if (unlockedNodes.has(node.id)) {
        continue;
      }
      this.options.store.unlockResearchNode({
        profileId,
        nodeId: node.id,
        cost: 0,
        ...(node.prerequisiteId ? { prerequisiteId: node.prerequisiteId } : {}),
        ...(node.prerequisiteIds ? { prerequisiteIds: node.prerequisiteIds } : {}),
        prerequisiteMode: node.prerequisiteMode,
        rewardCardIds: node.rewardCardIds,
      });
      unlockedNodes.add(node.id);
    }
    const starterCardIds = new Set<string>();
    for (const deck of this.options.content.decks.values()) {
      for (const cardId of deck.blueprintCardIds) {
        starterCardIds.add(cardId);
      }
      for (const actionId of deck.signatureActionIds) {
        starterCardIds.add(actionId);
      }
    }
    this.options.store.unlockCards(profileId, [...starterCardIds]);
    this.options.store.recordContentVersion(
      this.options.content.manifest.version,
      this.options.content.manifest,
    );
  }

  /** 创建玩家对 Agent 的标准对局。 */
  createMatch(input: {
    readonly deckId: string;
    readonly difficulty: "trainee" | "standard" | "adversarial";
    readonly seed?: number;
    readonly profileId?: string;
  }): MatchSummary {
    const profileId = input.profileId ?? this.options.profileId;
    const profile = this.options.store.ensureProfile(profileId);
    const deck = this.resolveDeck(input.deckId, profile.id);
    if (profile.faction === null) {
      throw new ServiceError(409, "PROFILE_FACTION_REQUIRED", "必须先选择中国财团或西方财团");
    }
    if (deck.faction !== profile.faction) {
      throw new ServiceError(
        422,
        "FACTION_MISMATCH",
        `牌组属于 ${deck.faction} 财团，当前档案属于 ${profile.faction} 财团`,
      );
    }
    const playerSeatId = "player";
    const agentSeatId = "agent";
    const matchId = ulid();
    const seed = input.seed ?? this.seedFactory();
    const agentFaction = opposingConsortiumFaction(profile.faction);
    const agentDeck = buildRandomAgentDeck(this.options.content, seed, agentFaction);
    const definitionOptions: ModelMayhemDefinitionOptions = {
      content: this.options.content,
      ...(this.options.now ? { now: this.options.now } : {}),
      seats: [
        {
          seatId: agentSeatId,
          displayName:
            input.difficulty === "trainee"
              ? "陪练 Agent"
              : input.difficulty === "standard"
                ? "标准 Agent"
                : "对抗型 Agent",
          deckId: agentDeck.id,
          faction: agentDeck.faction,
          deck: agentDeck,
        },
        {
          seatId: playerSeatId,
          displayName: "玩家",
          deckId: deck.id,
          faction: deck.faction,
          deck,
        },
      ],
    };
    const runtime = GameRuntime.create(createModelMayhemDefinition(definitionOptions), {
      gameId: matchId,
      seed,
      seats: [
        { id: agentSeatId, displayName: "Agent" },
        { id: playerSeatId, displayName: "玩家" },
      ],
    });
    const playerToken = createSeatToken();
    const agentToken = createSeatToken();
    const entry: MatchEntry = {
      runtime,
      profileId,
      difficulty: input.difficulty,
      tokens: new Map([
        [playerToken, playerSeatId],
        [agentToken, agentSeatId],
      ]),
      events: new EventEmitter(),
      processedCommands: new Map(),
      agentRunInFlight: false,
      agentError: null,
      researchAwarded: false,
    };
    this.matches.set(matchId, entry);
    this.tokenIndex.set(playerToken, matchId);
    this.tokenIndex.set(agentToken, matchId);
    this.options.store.createMatch({
      id: matchId,
      profileId,
      seed,
      agentDifficulty: entry.difficulty,
      snapshot: runtime.snapshot(),
    });
    this.maybeRunAgent(matchId);
    return {
      matchId,
      playerSeatId,
      seatToken: playerToken,
      seed,
      view: runtime.view({ seatId: playerSeatId, kind: "human" }),
    };
  }

  /** 从令牌解析受约束的工具上下文。 */
  contextFromToken(token: string): ToolContext {
    const matchId = this.tokenIndex.get(token);
    if (!matchId) {
      throw new ServiceError(401, "INVALID_SEAT_TOKEN", "座位令牌无效或已失效");
    }
    const entry = this.matches.get(matchId);
    const seatId = entry?.tokens.get(token);
    if (!entry || !seatId) {
      throw new ServiceError(401, "INVALID_SEAT_TOKEN", "座位令牌无效或已失效");
    }
    const kind = seatId === "agent" ? "agent" : "human";
    return {
      matchId,
      seatId,
      actorKind: kind,
      profileId: entry.profileId,
      permissions: kind === "agent" ? ["read", "play"] : ["read", "play", "progress", "replay"],
      difficulty: entry.difficulty,
    };
  }

  /** 读取公开视图。 */
  getView(matchId: string, seatId: string): ModelMayhemView {
    const entry = this.requireEntry(matchId);
    this.settleExpiredTechCheck(matchId, entry);
    return entry.runtime.view(actorForSeat(seatId, seatId === "agent" ? "agent" : "human"));
  }

  /** 为本地单机玩家重新签发座位令牌，并撤销该局此前签发的全部令牌。 */
  resumePlayerMatch(matchId: string): {
    readonly matchId: string;
    readonly seatToken: string;
    readonly view: ModelMayhemView;
  } {
    const entry = this.requireEntry(matchId);
    this.settleExpiredTechCheck(matchId, entry);
    for (const [oldToken] of entry.tokens) {
      this.tokenIndex.delete(oldToken);
    }
    entry.tokens.clear();
    const playerToken = createSeatToken();
    const agentToken = createSeatToken();
    entry.tokens.set(playerToken, "player");
    entry.tokens.set(agentToken, "agent");
    this.tokenIndex.set(playerToken, matchId);
    this.tokenIndex.set(agentToken, matchId);
    entry.agentError = null;
    entry.researchAwarded = entry.runtime.snapshot().game.phase === "finished";
    this.maybeRunAgent(matchId);
    return {
      matchId,
      seatToken: playerToken,
      view: entry.runtime.view({ seatId: "player", kind: "human" }),
    };
  }

  /** 读取指定座位的合法行动。 */
  getLegalActions(matchId: string, seatId: string): readonly LegalAction[] {
    const entry = this.requireEntry(matchId);
    this.settleExpiredTechCheck(matchId, entry);
    const actor = actorForSeat(seatId, seatId === "agent" ? "agent" : "human");
    const legalActions = generateLegalActions(
      this.definitionOptionsFor(entry),
      entry.runtime.snapshot().game,
      actor,
    );
    return seatId === "agent"
      ? summarizeAgentMulliganActions(this.options.content, entry.runtime.view(actor), legalActions)
      : legalActions;
  }

  /** 在快照副本上模拟一个命令。 */
  simulate(matchId: string, seatId: string, action: ActionReference): unknown {
    const entry = this.requireEntry(matchId);
    this.settleExpiredTechCheck(matchId, entry);
    const command = this.resolveActionReference(entry, seatId, action);
    const actor = actorForSeat(seatId, seatId === "agent" ? "agent" : "human");
    const result = simulateModelMayhemCommand(
      this.definitionOptionsFor(entry),
      entry.runtime.snapshot(),
      actor,
      command,
    );
    return projectSimulationResult(this.options.content, result, seatId, actor);
  }

  /** 提交真实命令并持久化事件。 */
  submitCommand(
    matchId: string,
    seatId: string,
    commandId: string,
    action: ActionReference,
  ): SubmitCommandResult {
    const entry = this.requireEntry(matchId);
    this.settleExpiredTechCheck(matchId, entry);
    const actor = actorForSeat(seatId, seatId === "agent" ? "agent" : "human");
    const cached = entry.processedCommands.get(commandId);
    if (cached) {
      return {
        accepted: cached.accepted,
        view: entry.runtime.view(actor),
        events: cached.events,
        ...(cached.violation ? { violation: cached.violation } : {}),
      };
    }
    const command = this.resolveActionReference(entry, seatId, action);
    const previousPhase = entry.runtime.snapshot().game.phase;
    const result = entry.runtime.dispatch({
      commandId,
      actor,
      command,
    });
    if (!result.accepted) {
      const rejected: SubmitCommandResult = {
        accepted: false,
        view: entry.runtime.view(actor),
        events: [],
        violation: result.violation,
      };
      this.cacheCommandResult(entry, commandId, rejected);
      return rejected;
    }
    this.applyAcceptedCommand(entry, matchId, previousPhase, result.snapshot, result.events);
    this.maybeRunAgent(matchId);
    const accepted: SubmitCommandResult = {
      accepted: true,
      view: entry.runtime.view(actor),
      events: result.events,
    };
    this.cacheCommandResult(entry, commandId, accepted);
    return accepted;
  }

  /** 等待轮到指定座位或超时。 */
  async waitForTurn(
    matchId: string,
    seatId: string,
    timeoutMs: number,
  ): Promise<{ readonly active: boolean; readonly elapsedMs: number }> {
    const started = Date.now();
    while (Date.now() - started <= timeoutMs) {
      const entry = this.requireEntry(matchId);
      this.settleExpiredTechCheck(matchId, entry);
      const state = entry.runtime.snapshot().game;
      if (state.phase === "finished") {
        return { active: false, elapsedMs: Date.now() - started };
      }
      if (state.activeSeatId === seatId) {
        return { active: true, elapsedMs: Date.now() - started };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { active: false, elapsedMs: Date.now() - started };
  }

  /** 订阅对局实时事件。 */
  subscribe(
    matchId: string,
    seatId: string,
    listener: (event: GameEvent<ModelMayhemEventType, ModelMayhemEventPayload>) => void,
  ): () => void {
    const entry = this.requireEntry(matchId);
    const filteredListener = (event: GameEvent<ModelMayhemEventType, ModelMayhemEventPayload>) => {
      if (isPrivateEventForSeat(event, seatId)) {
        listener(event);
      }
    };
    entry.events.on("event", filteredListener);
    return () => entry.events.off("event", filteredListener);
  }

  /** 读取按座位过滤后的持久化回放。 */
  getReplay(matchId: string, seatId: string): unknown {
    const match = this.options.store.getMatch(matchId);
    if (!match) {
      throw new ServiceError(404, "MATCH_NOT_FOUND", "对局不存在");
    }
    return {
      match: {
        id: match.id,
        rulesetId: match.rulesetId,
        rulesetVersion: match.rulesetVersion,
        contentVersion: match.contentVersion,
        seed: match.seed,
        status: match.status,
        winnerSeatId: match.winnerSeatId,
        isDraw: match.isDraw,
        finishReason: match.finishReason,
      },
      events: this.options.store
        .listMatchEvents(matchId)
        .filter((event) => isPrivateEventForSeat(event, seatId)),
    };
  }

  /** 返回当前 Agent 调度状态。 */
  getAgentStatus(matchId: string): {
    readonly available: boolean;
    readonly running: boolean;
    readonly error: string | null;
  } {
    const entry = this.requireEntry(matchId);
    this.settleExpiredTechCheck(matchId, entry);
    return {
      available: this.options.agentRunner !== undefined && isDeepSeekKeyConfigured(),
      running: entry.agentRunInFlight,
      error: entry.agentError,
    };
  }

  /** 开发者命令直接修改沙盒对局状态，不进入正常合法行动通道。 */
  applySandboxMutation(
    matchId: string,
    seatId: string,
    mutate: (state: MatchState) => void,
  ): ModelMayhemView {
    const entry = this.requireEntry(matchId);
    const snapshot = entry.runtime.snapshot();
    const nextGame = structuredClone(snapshot.game);
    mutate(nextGame);
    entry.runtime = GameRuntime.restore(
      createModelMayhemDefinition(this.definitionOptionsFromSnapshot(snapshot)),
      { ...snapshot, game: nextGame },
    );
    this.options.store.saveMatchProgress(matchId, entry.runtime.snapshot(), []);
    return entry.runtime.view(actorForSeat(seatId, "human"));
  }

  /** 返回包含双方隐藏信息的沙盒快照。 */
  getSandboxSnapshot(matchId: string): unknown {
    return this.requireEntry(matchId).runtime.snapshot();
  }

  /** 清除某个档案在内存中的对局和令牌，数据库记录由仓储级联删除。 */
  clearProfileMatches(profileId: string): void {
    for (const [matchId, entry] of this.matches.entries()) {
      if (entry.profileId !== profileId) {
        continue;
      }
      for (const token of entry.tokens.keys()) {
        this.tokenIndex.delete(token);
      }
      entry.events.removeAllListeners();
      this.options.agentRunner?.disposeMatch?.(matchId);
      this.matches.delete(matchId);
    }
  }

  /**
   * 在服务端的任何读写入口前结算已经过期的技术检定。
   *
   * 结算只能由系统提交，普通玩家或 Agent 不能伪造该命令；超时按答错处理，
   * 仍然执行行动的基础效果。未过期或没有待结算检定时不做任何事。
   */
  private settleExpiredTechCheck(matchId: string, entry: MatchEntry): void {
    const pending = entry.runtime.snapshot().game.pendingTechCheck;
    if (!pending) {
      return;
    }
    const deadline = Date.parse(pending.deadlineAt);
    if (!Number.isFinite(deadline)) {
      throw new Error(`技术检定截止时间无效：${pending.deadlineAt}`);
    }
    const now = this.options.now?.() ?? Date.now();
    if (now < deadline) {
      return;
    }
    const previousPhase = entry.runtime.snapshot().game.phase;
    const result = entry.runtime.dispatch({
      commandId: `tech-check-timeout:${pending.actionInstanceId}`,
      actor: { seatId: pending.casterSeatId, kind: "system" },
      command: { kind: "resolve_tech_check_timeout" },
    });
    if (!result.accepted) {
      throw new Error(`技术检定超时结算被拒绝：${result.violation.message}`);
    }
    this.applyAcceptedCommand(entry, matchId, previousPhase, result.snapshot, result.events);
  }

  /** 统一处理已接受命令的持久化、广播、成长结算和终局清理。 */
  private applyAcceptedCommand(
    entry: MatchEntry,
    matchId: string,
    previousPhase: string,
    snapshot: GameSessionSnapshot<MatchState>,
    events: readonly GameEvent<ModelMayhemEventType, ModelMayhemEventPayload>[],
  ): void {
    this.options.store.saveMatchProgress(matchId, snapshot, events);
    for (const event of events) {
      entry.events.emit("event", event);
    }
    if (
      previousPhase !== "finished" &&
      snapshot.game.phase === "finished" &&
      !entry.researchAwarded
    ) {
      this.awardResearch(entry, snapshot.game);
      entry.researchAwarded = true;
    }
    if (snapshot.game.phase === "finished") {
      this.options.agentRunner?.disposeMatch?.(matchId);
    }
  }

  /** 记录最近命令的执行结果，重复请求直接返回同一结果而不再次推进状态。 */
  private cacheCommandResult(
    entry: MatchEntry,
    commandId: string,
    result: CachedCommandResult,
  ): void {
    if (entry.processedCommands.size >= MAX_CACHED_COMMAND_RESULTS) {
      const oldest = entry.processedCommands.keys().next().value;
      if (oldest !== undefined) {
        entry.processedCommands.delete(oldest);
      }
    }
    entry.processedCommands.set(commandId, result);
  }

  private maybeRunAgent(matchId: string): void {
    const entry = this.requireEntry(matchId);
    this.settleExpiredTechCheck(matchId, entry);
    const state = entry.runtime.snapshot().game;
    const shouldRun =
      state.phase === "mulligan"
        ? state.players.agent?.mulliganReady !== true
        : state.phase === "playing" && state.activeSeatId === "agent";
    if (entry.agentRunInFlight || state.phase === "finished" || !shouldRun) {
      return;
    }
    const runner = this.options.agentRunner;
    const gateway = this.gateway;
    if (!runner || !gateway) {
      entry.agentError = "Pi Agent 后端未配置";
      return;
    }
    if (!isDeepSeekKeyConfigured()) {
      entry.agentError = "DEEPSEEK_API_KEY 未配置，Agent 回合已暂停";
      return;
    }
    const agentToken = [...entry.tokens.entries()].find(([, seatId]) => seatId === "agent")?.[0];
    if (!agentToken) {
      entry.agentError = "Agent 座位令牌不存在";
      return;
    }
    const context = this.contextFromToken(agentToken);
    entry.agentRunInFlight = true;
    entry.agentError = null;
    void runner
      .run({
        matchId,
        context,
        gateway,
        difficulty: entry.difficulty,
        onAudit: (record) => {
          this.options.store.recordAgentRun({
            matchId,
            seatId: "agent",
            agentId: runner.id,
            eventType: record.eventType,
            ...(record.toolName ? { toolName: record.toolName } : {}),
            ...(record.input === undefined ? {} : { input: record.input }),
            ...(record.output === undefined ? {} : { output: record.output }),
            ...(record.errorMessage ? { errorMessage: record.errorMessage } : {}),
            ...(record.latencyMs === undefined ? {} : { latencyMs: record.latencyMs }),
          });
        },
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        entry.agentError = message;
        runner.disposeMatch?.(matchId);
        this.options.store.recordAgentRun({
          matchId,
          seatId: "agent",
          agentId: runner.id,
          eventType: "run_failed",
          errorMessage: message,
        });
      })
      .finally(() => {
        entry.agentRunInFlight = false;
        if (entry.agentError === null) {
          this.maybeRunAgent(matchId);
        }
      });
  }

  private resolveDeck(deckId: string, profileId: string) {
    const persisted = this.options.store.getDeck(deckId);
    if (persisted) {
      if (persisted.profileId !== profileId) {
        throw new ServiceError(403, "DECK_ACCESS_DENIED", "牌组不属于当前档案");
      }
      return {
        id: persisted.id,
        name: persisted.name,
        faction: persisted.faction,
        doctrineId: persisted.doctrineId,
        blueprintCardIds: [...persisted.blueprintCardIds],
        signatureActionIds: [...persisted.signatureActionIds],
        description: persisted.name,
      };
    }
    const preset = this.options.content.decks.get(deckId);
    if (!preset) {
      throw new ServiceError(404, "DECK_NOT_FOUND", `牌组不存在：${deckId}`);
    }
    return preset;
  }

  private resolveActionReference(
    entry: MatchEntry,
    seatId: string,
    action: ActionReference,
  ): ModelMayhemCommand {
    if (action.actionId !== undefined) {
      const actor = actorForSeat(seatId, seatId === "agent" ? "agent" : "human");
      const legalAction = generateLegalActions(
        this.definitionOptionsFor(entry),
        entry.runtime.snapshot().game,
        actor,
      ).find((candidate) => candidate.id === action.actionId);
      if (!legalAction) {
        throw new ServiceError(
          422,
          "ACTION_NOT_LEGAL",
          `行动不在当前合法行动中：${action.actionId}`,
        );
      }
      const { id: _id, label: _label, preview: _preview, ...command } = legalAction;
      return command as ModelMayhemCommand;
    }
    if (action.command === undefined) {
      throw new ServiceError(422, "ACTION_REFERENCE_EMPTY", "缺少合法行动 ID 或命令正文");
    }
    const parsed = ModelMayhemCommandSchema.safeParse(action.command);
    if (!parsed.success) {
      throw new ServiceError(
        422,
        "INVALID_COMMAND",
        "命令不符合 Model Mayhem 结构",
        parsed.error.issues,
      );
    }
    return parsed.data;
  }

  private awardResearch(entry: MatchEntry, state: MatchState): void {
    const player = state.players.player;
    if (!player) {
      throw new Error("终局状态缺少玩家座位");
    }
    const rewards = this.options.content.balance.researchRewards;
    const profile = this.options.store.getProfile(entry.profileId);
    const newAccountBonus =
      profile && profile.completedMatches < rewards.newAccountMatches ? rewards.newAccountBonus : 0;
    const outcomeBonus = state.isDraw
      ? rewards.draw
      : state.winnerSeatId === "player"
        ? rewards.victory
        : 0;
    this.options.store.recordMatchCompletion({
      profileId: entry.profileId,
      researchData: rewards.completion + outcomeBonus + newAccountBonus,
    });
  }

  private requireEntry(matchId: string): MatchEntry {
    const existing = this.matches.get(matchId);
    if (existing) {
      return existing;
    }
    const persisted = this.options.store.getMatch(matchId);
    if (!persisted) {
      throw new ServiceError(404, "MATCH_NOT_FOUND", "对局不存在");
    }
    const definition = createModelMayhemDefinition(
      this.definitionOptionsFromSnapshot(persisted.snapshot),
    );
    const runtime = GameRuntime.restore(definition, persisted.snapshot);
    const entry: MatchEntry = {
      runtime,
      profileId: persisted.profileId,
      difficulty: persisted.agentDifficulty,
      tokens: new Map(),
      events: new EventEmitter(),
      processedCommands: new Map(),
      agentRunInFlight: false,
      agentError: "服务重启后需要重新签发座位令牌",
      researchAwarded: persisted.status === "finished",
    };
    this.matches.set(matchId, entry);
    return entry;
  }

  private definitionOptionsFor(entry: MatchEntry): ModelMayhemDefinitionOptions {
    return this.definitionOptionsFromSnapshot(entry.runtime.snapshot());
  }

  private definitionOptionsFromSnapshot(
    snapshot: GameSessionSnapshot<MatchState>,
  ): ModelMayhemDefinitionOptions {
    const firstPlayer = snapshot.game.players[snapshot.game.seats[0]];
    const secondPlayer = snapshot.game.players[snapshot.game.seats[1]];
    if (!firstPlayer || !secondPlayer) {
      throw new Error("对局快照缺少座位玩家");
    }
    return {
      content: this.options.content,
      ...(this.options.now ? { now: this.options.now } : {}),
      seats: [
        {
          seatId: snapshot.game.seats[0],
          displayName: firstPlayer.displayName,
          deckId: `snapshot-${snapshot.game.seats[0]}`,
          faction: firstPlayer.faction,
          deck: this.deckConfigForSnapshotSeat(snapshot, snapshot.game.seats[0]),
        },
        {
          seatId: snapshot.game.seats[1],
          displayName: secondPlayer.displayName,
          deckId: `snapshot-${snapshot.game.seats[1]}`,
          faction: secondPlayer.faction,
          deck: this.deckConfigForSnapshotSeat(snapshot, snapshot.game.seats[1]),
        },
      ],
    };
  }

  private deckConfigForSnapshotSeat(
    snapshot: GameSessionSnapshot<MatchState>,
    seatId: string,
  ): DeckConfig {
    const player = snapshot.game.players[seatId];
    if (!player) {
      throw new Error(`快照缺少玩家：${seatId}`);
    }
    const blueprintCardIds = Object.values(snapshot.game.cardInstances)
      .filter((instance) => instance.ownerSeatId === seatId)
      .map((instance) => instance.cardId);
    return {
      id: `snapshot-${seatId}`,
      name: `${player.displayName} 对局牌组`,
      faction: player.faction,
      doctrineId: player.doctrineId,
      blueprintCardIds,
      signatureActionIds: [...player.signatureActionIds],
      description: "从对局快照恢复的牌组配置",
    };
  }
}
