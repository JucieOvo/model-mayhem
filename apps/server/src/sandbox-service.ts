/**
 * 官方沙盒与开发者命令服务。
 *
 * 作者：JucieOvo
 *
 * 沙盒命令只作用于独立档案，并且全部通过仓储或对局服务执行。接口默认关闭，
 * 即使启用也默认拒绝非本机来源。
 */

import type { SandboxCommand, SandboxCommandResult, SandboxStatus } from "@modelmayhem/contracts";
import type { ContentPack } from "@modelmayhem/model-mayhem-content";
import type { MatchState } from "@modelmayhem/model-mayhem-rules";
import type { PersistenceStore } from "@modelmayhem/persistence";
import { ServiceError } from "./errors";
import type { MatchService } from "./match-service";

export interface SandboxServiceOptions {
  readonly enabled: boolean;
  readonly remoteEnabled: boolean;
  readonly profileId: string;
  readonly content: ContentPack;
  readonly store: PersistenceStore;
  readonly matchService: MatchService;
}

function clamp(value: number, minimum: number, maximum?: number): number {
  const lowerBounded = Math.max(minimum, value);
  return maximum === undefined ? lowerBounded : Math.min(maximum, lowerBounded);
}

export class SandboxService {
  constructor(private readonly options: SandboxServiceOptions) {
    if (options.enabled) {
      options.matchService.initializeProfile(options.profileId, "沙盒玩家", "sandbox");
    }
  }

  isEnabled(): boolean {
    return this.options.enabled;
  }

  isRemoteEnabled(): boolean {
    return this.options.remoteEnabled;
  }

  getProfileId(): string {
    return this.options.profileId;
  }

  checkAccess(remoteAddress?: string): void {
    this.assertEnabled();
    this.assertSource(remoteAddress);
  }

  getStatus(): SandboxStatus {
    this.assertEnabled();
    const profile = this.options.store.ensureProfile(this.options.profileId, "沙盒玩家", "sandbox");
    return {
      enabled: this.options.enabled,
      remoteEnabled: this.options.remoteEnabled,
      profileId: profile.id,
      faction: profile.faction,
      researchData: profile.researchData,
      completedMatches: profile.completedMatches,
      collectionCount: this.options.store.listCollection(profile.id).length,
      unlockedResearchCount: this.options.store.listResearchNodes(profile.id).length,
    };
  }

  async execute(command: SandboxCommand, remoteAddress?: string): Promise<SandboxCommandResult> {
    this.assertEnabled();
    this.assertSource(remoteAddress);
    const before = this.getStatus();
    const matchId = "matchId" in command ? command.matchId : undefined;
    const after = await this.applyCommand(command);
    this.options.store.recordDeveloperOperation({
      profileId: this.options.profileId,
      ...(matchId ? { matchId } : {}),
      command: command.kind,
      before,
      after,
    });
    return {
      accepted: true,
      kind: command.kind,
      before,
      after,
      message: `沙盒命令已执行：${command.kind}`,
    };
  }

  createMatch(
    input: {
      readonly deckId: string;
      readonly difficulty: "trainee" | "standard" | "adversarial";
      readonly seed?: number;
    },
    remoteAddress?: string,
  ) {
    this.checkAccess(remoteAddress);
    return this.options.matchService.createMatch({
      ...input,
      profileId: this.options.profileId,
    });
  }

  private async applyCommand(command: SandboxCommand): Promise<SandboxStatus | unknown> {
    switch (command.kind) {
      case "set_faction": {
        this.options.store.setProfileFaction(this.options.profileId, command.faction);
        return this.getStatus();
      }
      case "unlock_all_cards": {
        this.options.store.unlockCards(this.options.profileId, [
          ...this.options.content.cards.keys(),
        ]);
        return this.getStatus();
      }
      case "unlock_all_research": {
        this.options.store.unlockAllResearch({
          profileId: this.options.profileId,
          nodes: [...this.options.content.researchNodes.values()].map((node) => ({
            id: node.id,
            rewardCardIds: node.rewardCardIds,
          })),
        });
        return this.getStatus();
      }
      case "complete_current_era": {
        const profile = this.options.store.ensureProfile(
          this.options.profileId,
          "沙盒玩家",
          "sandbox",
        );
        const current = this.options.content.eras.get(profile.currentEraId);
        if (!current?.nextEraId) {
          throw new ServiceError(409, "SANDBOX_ERA_COMPLETE", "当前已经处于最后一个时代");
        }
        this.options.store.setCurrentEra(this.options.profileId, current.nextEraId);
        return this.getStatus();
      }
      case "grant_research_data": {
        this.options.store.grantResearchData(this.options.profileId, command.amount);
        return this.getStatus();
      }
      case "grant_match_resource": {
        this.assertSandboxMatch(command.matchId);
        this.options.matchService.applySandboxMutation(command.matchId, "player", (state) => {
          const player = state.players.player;
          if (!player) {
            throw new ServiceError(409, "SANDBOX_PLAYER_MISSING", "沙盒对局缺少玩家状态");
          }
          if (command.resource === "compute") {
            player.compute = clamp(player.compute + command.amount, 0);
            return;
          }
          if (command.resource === "capital") {
            player.capital = clamp(
              player.capital + command.amount,
              0,
              this.options.content.balance.capitalLimit,
            );
            return;
          }
          player.influence = clamp(
            player.influence + command.amount,
            0,
            this.options.content.balance.influenceTarget,
          );
        });
        return { matchId: command.matchId, resource: command.resource, amount: command.amount };
      }
      case "set_match_influence": {
        this.assertSandboxMatch(command.matchId);
        this.options.matchService.applySandboxMutation(command.matchId, "player", (state) => {
          const player = state.players.player;
          if (!player) {
            throw new ServiceError(409, "SANDBOX_PLAYER_MISSING", "沙盒对局缺少玩家状态");
          }
          player.influence = command.amount;
          if (command.amount >= this.options.content.balance.influenceTarget) {
            this.finishForPlayer(state);
          }
        });
        return { matchId: command.matchId, influence: command.amount };
      }
      case "grant_card": {
        if (!this.options.content.cards.has(command.cardId)) {
          throw new ServiceError(404, "SANDBOX_CARD_NOT_FOUND", `卡牌不存在：${command.cardId}`);
        }
        this.options.store.unlockCards(this.options.profileId, [command.cardId]);
        return this.getStatus();
      }
      case "complete_research_node": {
        const node = this.options.content.researchNodes.get(command.nodeId);
        if (!node) {
          throw new ServiceError(
            404,
            "SANDBOX_NODE_NOT_FOUND",
            `研究节点不存在：${command.nodeId}`,
          );
        }
        this.options.store.unlockAllResearch({
          profileId: this.options.profileId,
          nodes: [{ id: node.id, rewardCardIds: node.rewardCardIds }],
        });
        return this.getStatus();
      }
      case "force_world_event": {
        this.assertSandboxMatch(command.matchId);
        const card = this.options.content.worldEvents.get(command.cardId);
        if (!card) {
          throw new ServiceError(
            404,
            "SANDBOX_EVENT_NOT_FOUND",
            `世界事件不存在：${command.cardId}`,
          );
        }
        this.options.matchService.applySandboxMutation(command.matchId, "player", (state) => {
          state.worldEvent = {
            cardId: card.id,
            startedAtRound: state.round,
            expiresAfterRound: state.round + card.durationRounds,
          };
        });
        return { matchId: command.matchId, cardId: command.cardId };
      }
      case "set_round": {
        this.assertSandboxMatch(command.matchId);
        this.options.matchService.applySandboxMutation(command.matchId, "player", (state) => {
          state.round = command.round;
        });
        return { matchId: command.matchId, round: command.round };
      }
      case "reveal_opponent": {
        this.assertSandboxMatch(command.matchId);
        return this.options.matchService.getSandboxSnapshot(command.matchId);
      }
      case "instant_win": {
        this.assertSandboxMatch(command.matchId);
        this.options.matchService.applySandboxMutation(command.matchId, "player", (state) => {
          this.finishForPlayer(state);
        });
        return { matchId: command.matchId, winnerSeatId: "player" };
      }
      case "reset_sandbox": {
        this.options.matchService.clearProfileMatches(this.options.profileId);
        this.options.store.resetProfile(this.options.profileId);
        this.options.matchService.initializeProfile(this.options.profileId, "沙盒玩家", "sandbox");
        return this.getStatus();
      }
    }
  }

  private finishForPlayer(state: MatchState): void {
    state.phase = "finished";
    state.activeSeatId = null;
    state.pendingTechCheck = null;
    state.winnerSeatId = "player";
    state.isDraw = false;
    state.finishReason = "developer";
  }

  private assertSandboxMatch(matchId: string): void {
    const match = this.options.store.getMatch(matchId);
    if (!match || match.profileId !== this.options.profileId) {
      throw new ServiceError(403, "SANDBOX_MATCH_ACCESS_DENIED", "该对局不属于沙盒档案");
    }
  }

  private assertEnabled(): void {
    if (!this.options.enabled) {
      throw new ServiceError(404, "SANDBOX_DISABLED", "沙盒模式未启用");
    }
  }

  private assertSource(remoteAddress: string | undefined): void {
    if (this.options.remoteEnabled) {
      return;
    }
    if (
      remoteAddress === undefined ||
      remoteAddress === "127.0.0.1" ||
      remoteAddress === "::1" ||
      remoteAddress === "::ffff:127.0.0.1"
    ) {
      return;
    }
    throw new ServiceError(403, "SANDBOX_REMOTE_DENIED", "开发者接口默认只允许本机访问");
  }
}
