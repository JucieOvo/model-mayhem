/**
 * 档案、研究、牌组与对局的仓储实现。
 *
 * 作者：JucieOvo
 *
 * 仓储不解释卡牌效果，只保存服务端已经结算的事实。研究解锁在数据库事务中
 * 校验节点费用和前置条件，失败时整笔操作回滚。
 */

import type { TutorialProgress, TutorialStepId } from "@modelmayhem/contracts";
import type { GameEvent, GameSessionSnapshot } from "@modelmayhem/game-kernel";
import type {
  MatchState,
  ModelMayhemEventPayload,
  ModelMayhemEventType,
} from "@modelmayhem/model-mayhem-rules";
import { and, asc, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { PersistenceDatabase } from "./database";
import {
  agentRuns,
  collection,
  contentVersions,
  decks,
  developerOperations,
  matchEvents,
  matches,
  profiles,
  researchProgress,
  tutorialProgress,
} from "./schema";

export interface ProfileRecord {
  readonly id: string;
  readonly displayName: string;
  readonly kind: "official" | "sandbox";
  readonly faction: "china" | "west" | null;
  readonly researchData: number;
  readonly completedMatches: number;
  readonly currentEraId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DeckRecord {
  readonly id: string;
  readonly profileId: string;
  readonly name: string;
  readonly faction: "china" | "west";
  readonly doctrineId: string;
  readonly blueprintCardIds: readonly string[];
  readonly signatureActionIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MatchRecord {
  readonly id: string;
  readonly profileId: string;
  readonly rulesetId: string;
  readonly rulesetVersion: string;
  readonly contentVersion: string;
  readonly seed: number;
  readonly agentDifficulty: "trainee" | "standard" | "adversarial";
  readonly status: "playing" | "finished";
  readonly winnerSeatId: string | null;
  readonly isDraw: boolean;
  readonly finishReason: string | null;
  readonly snapshot: GameSessionSnapshot<MatchState>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResearchUnlockInput {
  readonly profileId: string;
  readonly nodeId: string;
  readonly cost: number;
  readonly prerequisiteId?: string;
  readonly prerequisiteIds?: readonly string[];
  readonly prerequisiteMode?: "all" | "any";
  readonly rewardCardIds: readonly string[];
  readonly now?: string;
}

export class PersistenceStore {
  constructor(
    private readonly db: PersistenceDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** 创建或读取本地档案。 */
  ensureProfile(
    profileId: string = "local",
    displayName = "本地玩家",
    kind: "official" | "sandbox" = "official",
  ): ProfileRecord {
    const now = this.now();
    this.db
      .insert(profiles)
      .values({
        id: profileId,
        displayName,
        kind,
        researchData: 0,
        completedMatches: 0,
        currentEraId: "gpt3",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`档案创建失败：${profileId}`);
    }
    return profile;
  }

  /** 读取档案。 */
  getProfile(profileId: string): ProfileRecord | undefined {
    return this.db.select().from(profiles).where(eq(profiles.id, profileId)).get();
  }

  /** 首次确定档案财团；确定后不允许通过普通接口更换。 */
  setProfileFaction(profileId: string, faction: "china" | "west"): ProfileRecord {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`档案不存在：${profileId}`);
    }
    if (profile.faction !== null && profile.faction !== faction) {
      throw new Error(`档案财团已经确定为 ${profile.faction}，不能改为 ${faction}`);
    }
    if (profile.faction === null) {
      this.db
        .update(profiles)
        .set({ faction, updatedAt: this.now() })
        .where(eq(profiles.id, profileId))
        .run();
    }
    const updated = this.getProfile(profileId);
    if (!updated) {
      throw new Error(`档案财团更新失败：${profileId}`);
    }
    return updated;
  }

  /** 读取已解锁研究节点。 */
  listResearchNodes(profileId: string): readonly string[] {
    return this.db
      .select({ nodeId: researchProgress.nodeId })
      .from(researchProgress)
      .where(eq(researchProgress.profileId, profileId))
      .orderBy(asc(researchProgress.unlockedAt))
      .all()
      .map((row) => row.nodeId);
  }

  /** 读取收藏卡牌。 */
  listCollection(profileId: string): readonly string[] {
    return this.db
      .select({ cardId: collection.cardId })
      .from(collection)
      .where(eq(collection.profileId, profileId))
      .orderBy(asc(collection.unlockedAt))
      .all()
      .map((row) => row.cardId);
  }

  /** 幂等写入新账号初始收藏。 */
  unlockCards(profileId: string, cardIds: readonly string[]): void {
    const timestamp = this.now();
    this.db.transaction((transaction) => {
      for (const cardId of new Set(cardIds)) {
        transaction
          .insert(collection)
          .values({
            profileId,
            cardId,
            unlockedAt: timestamp,
          })
          .onConflictDoNothing()
          .run();
      }
    });
  }

  /** 开发者直接增加研究数据。 */
  grantResearchData(profileId: string, amount: number): ProfileRecord {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`档案不存在：${profileId}`);
    }
    this.db
      .update(profiles)
      .set({
        researchData: Math.max(0, profile.researchData + amount),
        updatedAt: this.now(),
      })
      .where(eq(profiles.id, profileId))
      .run();
    const updated = this.getProfile(profileId);
    if (!updated) {
      throw new Error(`研究数据更新失败：${profileId}`);
    }
    return updated;
  }

  /** 沙盒命令直接解锁全部研究，不检查费用和前置。 */
  unlockAllResearch(input: {
    readonly profileId: string;
    readonly nodes: readonly {
      readonly id: string;
      readonly rewardCardIds: readonly string[];
    }[];
  }): number {
    const timestamp = this.now();
    return this.db.transaction((transaction) => {
      let inserted = 0;
      for (const node of input.nodes) {
        const result = transaction
          .insert(researchProgress)
          .values({
            profileId: input.profileId,
            nodeId: node.id,
            unlockedAt: timestamp,
          })
          .onConflictDoNothing()
          .run();
        inserted += result.changes;
        for (const cardId of new Set(node.rewardCardIds)) {
          transaction
            .insert(collection)
            .values({
              profileId: input.profileId,
              cardId,
              unlockedAt: timestamp,
            })
            .onConflictDoNothing()
            .run();
        }
      }
      return inserted;
    });
  }

  /** 沙盒命令直接设置当前时代。 */
  setCurrentEra(profileId: string, eraId: string): ProfileRecord {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`档案不存在：${profileId}`);
    }
    this.db
      .update(profiles)
      .set({ currentEraId: eraId, updatedAt: this.now() })
      .where(eq(profiles.id, profileId))
      .run();
    const updated = this.getProfile(profileId);
    if (!updated) {
      throw new Error(`时代更新失败：${profileId}`);
    }
    return updated;
  }

  /** 在事务中解锁研究节点。 */
  unlockResearchNode(input: ResearchUnlockInput): number {
    const timestamp = input.now ?? this.now();
    return this.db.transaction((transaction) => {
      const profile = transaction
        .select()
        .from(profiles)
        .where(eq(profiles.id, input.profileId))
        .get();
      if (!profile) {
        throw new Error(`档案不存在：${input.profileId}`);
      }
      const existing = transaction
        .select({ nodeId: researchProgress.nodeId })
        .from(researchProgress)
        .where(
          and(
            eq(researchProgress.profileId, input.profileId),
            eq(researchProgress.nodeId, input.nodeId),
          ),
        )
        .get();
      if (existing) {
        throw new Error(`研究节点已经解锁：${input.nodeId}`);
      }
      const prerequisiteIds =
        input.prerequisiteIds ?? (input.prerequisiteId ? [input.prerequisiteId] : []);
      if (prerequisiteIds.length > 0) {
        const unlocked = new Set(
          transaction
            .select({ nodeId: researchProgress.nodeId })
            .from(researchProgress)
            .where(eq(researchProgress.profileId, input.profileId))
            .all()
            .map((row) => row.nodeId),
        );
        const satisfied =
          input.prerequisiteMode === "any"
            ? prerequisiteIds.some((nodeId) => unlocked.has(nodeId))
            : prerequisiteIds.every((nodeId) => unlocked.has(nodeId));
        if (!satisfied) {
          throw new Error(`研究前置节点尚未解锁：${prerequisiteIds.join("、")}`);
        }
      }
      if (profile.researchData < input.cost) {
        throw new Error(`研究数据不足：需要 ${input.cost}，当前 ${profile.researchData}`);
      }
      const remaining = profile.researchData - input.cost;
      transaction
        .update(profiles)
        .set({ researchData: remaining, updatedAt: timestamp })
        .where(eq(profiles.id, input.profileId))
        .run();
      transaction
        .insert(researchProgress)
        .values({
          profileId: input.profileId,
          nodeId: input.nodeId,
          unlockedAt: timestamp,
        })
        .run();
      for (const cardId of new Set(input.rewardCardIds)) {
        transaction
          .insert(collection)
          .values({
            profileId: input.profileId,
            cardId,
            unlockedAt: timestamp,
          })
          .onConflictDoNothing()
          .run();
      }
      return remaining;
    });
  }

  /** 保存牌组。 */
  saveDeck(input: {
    readonly id?: string;
    readonly profileId: string;
    readonly name: string;
    readonly faction: "china" | "west";
    readonly doctrineId: string;
    readonly blueprintCardIds: readonly string[];
    readonly signatureActionIds: readonly string[];
  }): DeckRecord {
    const timestamp = this.now();
    const id = input.id ?? ulid();
    const existing = input.id
      ? this.db.select().from(decks).where(eq(decks.id, input.id)).get()
      : undefined;
    if (existing && existing.profileId !== input.profileId) {
      throw new Error(`牌组 ${id} 不属于档案 ${input.profileId}`);
    }
    if (existing) {
      this.db
        .update(decks)
        .set({
          name: input.name,
          faction: input.faction,
          doctrineId: input.doctrineId,
          blueprintJson: JSON.stringify(input.blueprintCardIds),
          signatureJson: JSON.stringify(input.signatureActionIds),
          updatedAt: timestamp,
        })
        .where(eq(decks.id, id))
        .run();
    } else {
      this.db
        .insert(decks)
        .values({
          id,
          profileId: input.profileId,
          name: input.name,
          faction: input.faction,
          doctrineId: input.doctrineId,
          blueprintJson: JSON.stringify(input.blueprintCardIds),
          signatureJson: JSON.stringify(input.signatureActionIds),
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
    }
    const saved = this.getDeck(id);
    if (!saved) {
      throw new Error(`牌组保存失败：${id}`);
    }
    return saved;
  }

  /** 读取牌组。 */
  getDeck(deckId: string): DeckRecord | undefined {
    const row = this.db.select().from(decks).where(eq(decks.id, deckId)).get();
    return row ? this.mapDeck(row) : undefined;
  }

  /** 读取档案下全部牌组。 */
  listDecks(profileId: string): readonly DeckRecord[] {
    return this.db
      .select()
      .from(decks)
      .where(eq(decks.profileId, profileId))
      .orderBy(desc(decks.updatedAt))
      .all()
      .map((row) => this.mapDeck(row));
  }

  private mapDeck(row: typeof decks.$inferSelect): DeckRecord {
    return {
      id: row.id,
      profileId: row.profileId,
      name: row.name,
      faction: row.faction,
      doctrineId: row.doctrineId,
      blueprintCardIds: JSON.parse(row.blueprintJson) as string[],
      signatureActionIds: JSON.parse(row.signatureJson) as string[],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** 保存初始对局快照。 */
  createMatch(input: {
    readonly id: string;
    readonly profileId: string;
    readonly seed: number;
    readonly agentDifficulty: "trainee" | "standard" | "adversarial";
    readonly snapshot: GameSessionSnapshot<MatchState>;
  }): void {
    const timestamp = this.now();
    this.db
      .insert(matches)
      .values({
        id: input.id,
        profileId: input.profileId,
        rulesetId: input.snapshot.rulesetId,
        rulesetVersion: input.snapshot.rulesetVersion,
        contentVersion: input.snapshot.contentVersion,
        seed: input.seed,
        agentDifficulty: input.agentDifficulty,
        status: "playing",
        winnerSeatId: null,
        isDraw: false,
        finishReason: null,
        snapshotJson: JSON.stringify(input.snapshot),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }

  /** 在一条事务中保存快照和新增事件。 */
  saveMatchProgress(
    matchId: string,
    snapshot: GameSessionSnapshot<MatchState>,
    events: readonly GameEvent<ModelMayhemEventType, ModelMayhemEventPayload>[],
  ): void {
    const timestamp = this.now();
    this.db.transaction((transaction) => {
      transaction
        .update(matches)
        .set({
          snapshotJson: JSON.stringify(snapshot),
          status: snapshot.game.phase === "finished" ? "finished" : "playing",
          winnerSeatId: snapshot.game.winnerSeatId,
          isDraw: snapshot.game.isDraw,
          finishReason: snapshot.game.finishReason,
          updatedAt: timestamp,
        })
        .where(eq(matches.id, matchId))
        .run();
      for (const event of events) {
        transaction
          .insert(matchEvents)
          .values({
            matchId,
            sequence: event.sequence,
            eventId: event.id,
            commandId: event.commandId,
            actorSeatId: event.actor.seatId,
            actorKind: event.actor.kind,
            type: event.type,
            payloadJson: JSON.stringify(event.payload),
            createdAt: timestamp,
          })
          .onConflictDoNothing()
          .run();
      }
    });
  }

  /** 读取对局。 */
  getMatch(matchId: string): MatchRecord | undefined {
    const row = this.db.select().from(matches).where(eq(matches.id, matchId)).get();
    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      profileId: row.profileId,
      rulesetId: row.rulesetId,
      rulesetVersion: row.rulesetVersion,
      contentVersion: row.contentVersion,
      seed: row.seed,
      agentDifficulty: row.agentDifficulty,
      status: row.status,
      winnerSeatId: row.winnerSeatId,
      isDraw: row.isDraw,
      finishReason: row.finishReason,
      snapshot: JSON.parse(row.snapshotJson) as GameSessionSnapshot<MatchState>,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** 读取按序列排序的事件日志。 */
  listMatchEvents(matchId: string): readonly {
    readonly sequence: number;
    readonly eventId: string;
    readonly commandId: string;
    readonly actorSeatId: string;
    readonly actorKind: "human" | "agent" | "system";
    readonly type: string;
    readonly payload: unknown;
    readonly createdAt: string;
  }[] {
    return this.db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.matchId, matchId))
      .orderBy(asc(matchEvents.sequence))
      .all()
      .map((row) => ({
        sequence: row.sequence,
        eventId: row.eventId,
        commandId: row.commandId,
        actorSeatId: row.actorSeatId,
        actorKind: row.actorKind,
        type: row.type,
        payload: JSON.parse(row.payloadJson) as unknown,
        createdAt: row.createdAt,
      }));
  }

  /** 对局结束后更新档案统计和研究数据。 */
  recordMatchCompletion(input: {
    readonly profileId: string;
    readonly researchData: number;
  }): void {
    const profile = this.getProfile(input.profileId);
    if (!profile) {
      throw new Error(`档案不存在：${input.profileId}`);
    }
    this.db
      .update(profiles)
      .set({
        researchData: profile.researchData + input.researchData,
        completedMatches: profile.completedMatches + 1,
        updatedAt: this.now(),
      })
      .where(eq(profiles.id, input.profileId))
      .run();
  }

  /** 在满足时代门槛后推进当前时代。 */
  advanceEra(input: {
    readonly profileId: string;
    readonly expectedEraId: string;
    readonly nextEraId: string;
  }): void {
    const profile = this.getProfile(input.profileId);
    if (!profile) {
      throw new Error(`档案不存在：${input.profileId}`);
    }
    if (profile.currentEraId !== input.expectedEraId) {
      throw new Error(
        `当前时代已经变化：期望 ${input.expectedEraId}，实际 ${profile.currentEraId}`,
      );
    }
    this.db
      .update(profiles)
      .set({
        currentEraId: input.nextEraId,
        updatedAt: this.now(),
      })
      .where(eq(profiles.id, input.profileId))
      .run();
  }

  /** 追加 Agent 工具或模型运行轨迹。 */
  recordAgentRun(input: {
    readonly matchId: string;
    readonly seatId: string;
    readonly agentId: string;
    readonly eventType: string;
    readonly toolName?: string;
    readonly input?: unknown;
    readonly output?: unknown;
    readonly errorMessage?: string;
    readonly latencyMs?: number;
  }): void {
    this.db
      .insert(agentRuns)
      .values({
        id: ulid(),
        matchId: input.matchId,
        seatId: input.seatId,
        agentId: input.agentId,
        eventType: input.eventType,
        toolName: input.toolName ?? null,
        inputJson: input.input === undefined ? null : JSON.stringify(input.input),
        outputJson: input.output === undefined ? null : JSON.stringify(input.output),
        errorMessage: input.errorMessage ?? null,
        latencyMs: input.latencyMs ?? null,
        createdAt: this.now(),
      })
      .run();
  }

  /** 记录开发者命令的完整前后状态。 */
  recordDeveloperOperation(input: {
    readonly profileId: string;
    readonly matchId?: string;
    readonly command: string;
    readonly before: unknown;
    readonly after: unknown;
  }): void {
    this.db
      .insert(developerOperations)
      .values({
        id: ulid(),
        profileId: input.profileId,
        matchId: input.matchId ?? null,
        command: input.command,
        beforeJson: JSON.stringify(input.before),
        afterJson: JSON.stringify(input.after),
        createdAt: this.now(),
      })
      .run();
  }

  /** 读取教程进度；尚未创建时返回初始状态。 */
  getTutorialProgress(profileId: string): TutorialProgress {
    const row = this.db
      .select()
      .from(tutorialProgress)
      .where(eq(tutorialProgress.profileId, profileId))
      .get();
    if (!row) {
      return {
        profileId,
        completedSteps: [],
        dismissed: false,
        updatedAt: null,
      };
    }
    return {
      profileId,
      completedSteps: JSON.parse(row.completedJson) as TutorialStepId[],
      dismissed: row.dismissed,
      updatedAt: row.updatedAt,
    };
  }

  /** 幂等完成一个教程步骤。 */
  completeTutorialStep(profileId: string, stepId: TutorialStepId): TutorialProgress {
    const current = this.getTutorialProgress(profileId);
    const completedSteps = [...new Set([...current.completedSteps, stepId])];
    const updatedAt = this.now();
    this.db
      .insert(tutorialProgress)
      .values({
        profileId,
        completedJson: JSON.stringify(completedSteps),
        dismissed: current.dismissed,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: tutorialProgress.profileId,
        set: {
          completedJson: JSON.stringify(completedSteps),
          updatedAt,
        },
      })
      .run();
    return this.getTutorialProgress(profileId);
  }

  /** 记录教程提示是否已关闭。 */
  setTutorialDismissed(profileId: string, dismissed: boolean): TutorialProgress {
    const current = this.getTutorialProgress(profileId);
    const updatedAt = this.now();
    this.db
      .insert(tutorialProgress)
      .values({
        profileId,
        completedJson: JSON.stringify(current.completedSteps),
        dismissed,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: tutorialProgress.profileId,
        set: { dismissed, updatedAt },
      })
      .run();
    return this.getTutorialProgress(profileId);
  }

  /** 重置沙盒档案；外键级联清理该档案的全部派生数据。 */
  resetProfile(profileId: string): void {
    this.db.delete(profiles).where(eq(profiles.id, profileId)).run();
  }

  /** 记录已加载内容版本。 */
  recordContentVersion(version: string, manifest: unknown): void {
    this.db
      .insert(contentVersions)
      .values({
        version,
        manifestJson: JSON.stringify(manifest),
        loadedAt: this.now(),
      })
      .onConflictDoNothing()
      .run();
  }
}
