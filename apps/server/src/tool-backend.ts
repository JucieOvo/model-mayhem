/**
 * 服务端工具后端。
 *
 * 作者：JucieOvo
 *
 * 该类把统一工具网关连接到真实对局服务、内容包和持久化仓储。任何协议入口最终
 * 都调用这里的同一方法，不复制规则或权限逻辑。
 */

import { randomUUID } from "node:crypto";
import { SaveDeckRequestSchema } from "@modelmayhem/contracts";
import type { ToolBackend } from "@modelmayhem/game-tools";
import type { ContentPack } from "@modelmayhem/model-mayhem-content";
import { validateDeckComposition } from "@modelmayhem/model-mayhem-content";
import type { LegalAction } from "@modelmayhem/model-mayhem-rules";
import type { PersistenceStore } from "@modelmayhem/persistence";
import { ServiceError } from "./errors";
import type { MatchService } from "./match-service";

export interface ServerToolBackendOptions {
  readonly content: ContentPack;
  readonly store: PersistenceStore;
  readonly matchService: MatchService;
}

function validateDeck(
  content: ContentPack,
  collection: readonly string[],
  profileFaction: "china" | "west" | null,
  deck: {
    readonly faction: "china" | "west";
    readonly doctrineId: string;
    readonly blueprintCardIds: readonly string[];
    readonly signatureActionIds: readonly string[];
  },
): void {
  if (profileFaction === null) {
    throw new ServiceError(409, "PROFILE_FACTION_REQUIRED", "必须先选择中国财团或西方财团");
  }
  if (deck.faction !== profileFaction) {
    throw new ServiceError(
      422,
      "FACTION_MISMATCH",
      `牌组属于 ${deck.faction} 财团，当前档案属于 ${profileFaction} 财团`,
    );
  }
  const compositionIssues = validateDeckComposition(
    content.cards,
    content.doctrines,
    content.balance,
    {
      id: "pending-deck",
      name: "待校验牌组",
      faction: deck.faction,
      doctrineId: deck.doctrineId,
      blueprintCardIds: [...deck.blueprintCardIds],
      signatureActionIds: [...deck.signatureActionIds],
      description: "待校验牌组",
    },
  );
  const firstIssue = compositionIssues[0];
  if (firstIssue) {
    throw new ServiceError(422, firstIssue.code, firstIssue.message);
  }
  const unlocked = new Set(collection);
  for (const cardId of deck.blueprintCardIds) {
    const card = content.cards.get(cardId);
    if (!card) {
      throw new ServiceError(422, "INVALID_DECK", `卡牌不存在：${cardId}`);
    }
    if (!unlocked.has(cardId)) {
      throw new ServiceError(422, "CARD_NOT_UNLOCKED", `卡牌尚未解锁：${cardId}`);
    }
    if (card.type !== "organization" && card.type !== "asset") {
      throw new ServiceError(422, "INVALID_DECK", `卡牌不能放入蓝图牌堆：${cardId}`);
    }
  }
  for (const actionId of deck.signatureActionIds) {
    const action = content.actions.get(actionId);
    if (!action?.signature) {
      throw new ServiceError(422, "INVALID_DECK", `招牌行动无效：${actionId}`);
    }
    if (!unlocked.has(actionId)) {
      throw new ServiceError(422, "CARD_NOT_UNLOCKED", `招牌行动尚未解锁：${actionId}`);
    }
  }
}

function publicCard(content: ContentPack, cardId: string): unknown {
  const card = content.cards.get(cardId);
  if (!card) {
    throw new ServiceError(404, "CARD_NOT_FOUND", `卡牌不存在：${cardId}`);
  }
  if (card.type !== "action" || !card.techCheck) {
    return card;
  }
  return {
    ...card,
    techCheck: {
      questionId: card.techCheck.questionId,
      baseEffects: card.techCheck.baseEffects,
      enhancedEffects: card.techCheck.enhancedEffects,
    },
  };
}

function rulesSummary(content: ContentPack): Readonly<Record<string, unknown>> {
  const balance = content.balance;
  return {
    turnOrder: ["开始", "抽牌", "主要", "结束"],
    factions: {
      definition: "中国财团与西方财团是游戏内长期身份，标准对局中双方互为对立面",
      companyDeployment: "只能部署本财团公司和全球公司或平台",
      openAssets: "开放权重、开源和开放科学资产可以跨财团使用",
      closedModels: "对方财团闭源模型需要明确的跨财团访问效果",
    },
    influence: {
      target: balance.influenceTarget,
      perRoundGainLimit: balance.influenceGainPerRoundLimit,
      checkpoint: "每个原子效果完成后立即检查",
      steal: "夺取必须一次性完整结算；胜者空间或败者影响力不足时不夺取",
    },
    deck: {
      blueprintSize: balance.blueprintsPerDeck,
      openingBlueprintHand: balance.openingBlueprintHand,
      blueprintDrawPerTurn: balance.blueprintDrawPerTurn,
      blueprintPityDraws: balance.blueprintPityDraws,
      blueprintHandLimit: balance.blueprintHandLimit,
      actionDrawPerTurn: balance.actionDrawPerTurn,
      actionHandLimit: balance.actionHandLimit,
      discardRule:
        "回合开始抽到的行动牌可暂时超过上限；可以先用牌或主动弃置，结束回合时必须确保行动手牌不超过上限",
    },
    limits: {
      organizationsPerTurn: balance.organizationDeploysPerTurn,
      assetsPerTurn: balance.assetDeploysPerTurn,
      benchmarksPerTurn: balance.benchmarksPerTurn,
      techChecksPerTurn: balance.techChecksPerTurn,
      anchorStatuses: balance.statusLimitPerAnchor,
      modelStatuses: balance.statusLimitPerModel,
    },
    benchmark: {
      ...balance.benchmark,
      scoring: ["基础能力", "技术修正", "组织修正", "事件修正", "状态修正"],
      defenderSelection:
        "防守方可以预先指定自己的守擂模型；未指定或守擂模型失去资格时，自动选择当前能力得分最高的合格模型",
      heavyDefeat: `分差达到 ${balance.benchmark.heavyDefeatMargin} 时，败方模型承压 ${balance.benchmark.heavyDefeatPressureTurns} 个目标回合`,
    },
    statuses: [
      {
        id: "heat",
        effect: "模型下一次 Benchmark 得分 +1，参赛后消耗",
      },
      {
        id: "controversy",
        effect: "来源提供影响力时 -1，持续两个目标回合",
      },
      {
        id: "outage",
        effect: "据点行动组失效，旗下模型不能参赛，持续一个目标回合",
      },
      {
        id: "overload",
        effect: "下一次从该据点部署模型算力费用 +1，部署后消耗",
      },
      {
        id: "regulation",
        effect: "据点或模型的闭源、前沿标签效果失效，持续两轮",
      },
      {
        id: "training",
        effect: "当前目标回合不能参赛，下一次对应 Benchmark 能力 +1 后消耗",
      },
      {
        id: "fortify",
        effect: "抵消下一次负面状态后消耗",
      },
      {
        id: "momentum",
        effect: "下一张行动算力费用 -1，使用或目标回合结束后消耗",
      },
      {
        id: "pressure",
        effect: "模型下一目标回合不能参赛",
      },
    ],
    worldEvents: {
      triggerRounds: balance.worldEventRounds,
      onlyOneAtATime: true,
      affectsBothPlayers: true,
    },
    techCheck: {
      baseEffectAlwaysApplies: true,
      wrongAnswerCancelsAction: false,
      options: 4,
      timeoutEqualsWrong: true,
      seconds: balance.techCheckSeconds,
    },
  };
}

function semanticActions(actions: readonly LegalAction[]): readonly unknown[] {
  return actions.map(({ id: _id, label, preview, ...action }) => ({
    label,
    action,
    ...(preview ? { preview } : {}),
  }));
}

/** 创建服务端工具后端。 */
export function createServerToolBackend(options: ServerToolBackendOptions): ToolBackend {
  const { content, store, matchService } = options;
  return {
    async getMatchState(context) {
      return matchService.getView(context.matchId, context.seatId);
    },
    async getPrivateState(context) {
      const view = matchService.getView(context.matchId, context.seatId);
      return view.me;
    },
    async getLegalActions(context) {
      return semanticActions(matchService.getLegalActions(context.matchId, context.seatId));
    },
    async getTurnContext(context) {
      const view = matchService.getView(context.matchId, context.seatId);
      const legalActions = matchService.getLegalActions(context.matchId, context.seatId);
      const ownCardIds = new Set([
        ...view.me.blueprintHand.map((card) => card.cardId),
        ...view.me.actionHand.map((card) => card.cardId),
        ...view.me.blueprintDeckComposition.map((card) => card.cardId),
      ]);
      const ownCards = [...ownCardIds].map((cardId) => publicCard(content, cardId));
      const pendingAction =
        view.pendingTechCheck === null
          ? undefined
          : content.actions.get(view.pendingTechCheck.actionCardId);
      const question =
        pendingAction?.techCheck === undefined
          ? undefined
          : content.questions.get(pendingAction.techCheck.questionId);
      return {
        phase: view.phase,
        round: view.round,
        activeSeatId: view.activeSeatId,
        viewerSeatId: view.viewerSeatId,
        factionContext: {
          me: view.me.faction,
          opponent: view.opponent.faction,
          opposing: view.me.faction !== view.opponent.faction,
        },
        me: view.me,
        opponent: view.opponent,
        ownCards,
        ownBlueprintDeck: view.me.blueprintDeckComposition.map((entry) => ({
          cardId: entry.cardId,
          count: entry.count,
        })),
        turnBudgets: {
          organizationDeploys: {
            used: view.me.organizationDeploysThisTurn,
            limit: content.balance.organizationDeploysPerTurn,
          },
          assetDeploys: {
            used: view.me.assetDeploysThisTurn,
            limit: content.balance.assetDeploysPerTurn,
          },
          benchmarks: {
            used: view.me.benchmarksThisTurn,
            limit: content.balance.benchmarksPerTurn,
          },
          techChecks: {
            used: view.me.techChecksThisTurn,
            limit: content.balance.techChecksPerTurn,
          },
        },
        worldEvent:
          view.worldEvent === null
            ? null
            : {
                ...view.worldEvent,
                card: publicCard(content, view.worldEvent.cardId),
              },
        pendingTechCheck:
          view.pendingTechCheck === null
            ? null
            : {
                ...view.pendingTechCheck,
                question:
                  question === undefined
                    ? null
                    : {
                        prompt: question.prompt,
                        options: question.options,
                      },
              },
        rules: rulesSummary(content),
        availableActions: semanticActions(legalActions),
      };
    },
    async inspectCard(cardId) {
      return publicCard(content, cardId);
    },
    async inspectRules() {
      return {
        rulesetId: "model-mayhem",
        rulesetVersion: content.balance.version,
        contentVersion: content.manifest.version,
        balance: content.balance,
        summary: rulesSummary(content),
      };
    },
    async simulateAction(context, action) {
      return matchService.simulate(context.matchId, context.seatId, { command: action });
    },
    async submitAction(context, action) {
      return matchService.submitCommand(context.matchId, context.seatId, randomUUID(), {
        command: action,
      });
    },
    async waitForTurn(context, timeoutMs) {
      return matchService.waitForTurn(context.matchId, context.seatId, timeoutMs);
    },
    async getResearchMap(context) {
      const profile = store.ensureProfile(context.profileId);
      const unlockedNodes = new Set(store.listResearchNodes(context.profileId));
      const eras = [...content.eras.values()].sort((left, right) => left.order - right.order);
      const currentEra = eras.find((era) => era.id === profile.currentEraId);
      if (!currentEra) {
        throw new Error(`档案当前时代不存在：${profile.currentEraId}`);
      }
      const currentEraIndex = eras.indexOf(currentEra);
      const completed = {
        total: 0,
        paper: 0,
        technology: 0,
        model: 0,
      };
      for (const nodeId of unlockedNodes) {
        const node = content.researchNodes.get(nodeId);
        if (!node || node.stageId !== currentEra.id || !node.completionCategory) {
          continue;
        }
        completed.total += 1;
        completed[node.completionCategory] += 1;
      }
      const requirements = currentEra.requirements;
      const canAdvance =
        currentEra.nextEraId !== undefined &&
        completed.total >= requirements.total &&
        completed.paper >= requirements.paper &&
        completed.technology >= requirements.technology &&
        completed.model >= requirements.model;
      return {
        faction: profile.faction,
        researchData: profile.researchData,
        collectionCardIds: store.listCollection(context.profileId),
        eras: eras.map((era) => ({
          eraId: era.id,
          name: era.name,
          order: era.order,
          initial: era.initial,
          unlocked: era.order <= currentEraIndex,
        })),
        timeAdvance: {
          currentEraId: currentEra.id,
          ...(currentEra.nextEraId ? { nextEraId: currentEra.nextEraId } : {}),
          requirements,
          completed,
          canAdvance,
        },
        nodes: [...content.researchNodes.values()].map((node) => {
          const unlocked = unlockedNodes.has(node.id);
          const prerequisiteIds =
            node.prerequisiteIds ?? (node.prerequisiteId ? [node.prerequisiteId] : []);
          const prerequisiteMet =
            prerequisiteIds.length === 0 ||
            (node.prerequisiteMode === "any"
              ? prerequisiteIds.some((id) => unlockedNodes.has(id))
              : prerequisiteIds.every((id) => unlockedNodes.has(id)));
          const stage = node.stageId ? content.eras.get(node.stageId) : undefined;
          const stageUnlocked = stage === undefined || stage.order <= currentEraIndex;
          return {
            nodeId: node.id,
            branch: node.branch,
            name: node.name,
            depth: node.depth,
            unlocked,
            available: !unlocked && prerequisiteMet && stageUnlocked,
            cost: node.cost,
            rewardCardIds: node.rewardCardIds,
            missingResearchData: Math.max(0, node.cost - profile.researchData),
            ...(node.stageId ? { stageId: node.stageId } : {}),
            ...(node.completionCategory ? { completionCategory: node.completionCategory } : {}),
            lineageIds: node.lineageIds,
            prerequisiteIds,
            prerequisiteMode: node.prerequisiteMode,
          };
        }),
      };
    },
    async updateDeck(context, deckInput) {
      const parsed = SaveDeckRequestSchema.safeParse(deckInput);
      if (!parsed.success) {
        throw new ServiceError(
          422,
          "INVALID_DECK_REQUEST",
          "牌组请求结构无效",
          parsed.error.issues,
        );
      }
      const profile = store.ensureProfile(context.profileId);
      validateDeck(content, store.listCollection(context.profileId), profile.faction, parsed.data);
      return store.saveDeck({
        ...(parsed.data.id ? { id: parsed.data.id } : {}),
        profileId: context.profileId,
        name: parsed.data.name,
        faction: parsed.data.faction,
        doctrineId: parsed.data.doctrineId,
        blueprintCardIds: parsed.data.blueprintCardIds,
        signatureActionIds: parsed.data.signatureActionIds,
      });
    },
    async getReplay(context) {
      return matchService.getReplay(context.matchId);
    },
  };
}
