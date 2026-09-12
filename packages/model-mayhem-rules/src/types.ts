/**
 * Model Mayhem 对局领域类型。
 *
 * 作者：JucieOvo
 *
 * 这里描述参考规则包的完整状态、命令、事件和初始化配置。通用回合框架契约
 * 来自 @modelmayhem/game-kernel，本文件只处理具体规则语义。
 */

import type {
  Ability,
  ActionCard,
  AssetCard,
  BenchmarkType,
  CardSelector,
  ConsortiumFaction,
  ContentPack,
  DeckConfig,
  Effect,
  EffectAttackType,
  StatusId,
  TargetingRule,
  TargetRole,
} from "@modelmayhem/model-mayhem-content";

export type MatchPhase = "mulligan" | "playing" | "finished";
export type MatchFinishReason =
  | "influence_target"
  | "round_limit"
  | "surrender"
  | "developer"
  | "simultaneous_target"
  | null;

export interface MatchSeatSetup {
  readonly seatId: string;
  readonly displayName: string;
  readonly deckId: string;
  readonly faction?: ConsortiumFaction;
  readonly deck?: DeckConfig;
}

export interface ModelMayhemDefinitionOptions {
  readonly content: ContentPack;
  readonly seats: readonly [MatchSeatSetup, MatchSeatSetup];
}

export interface CardInstance {
  readonly id: string;
  readonly cardId: string;
  readonly ownerSeatId: string;
}

export interface ActionInstance {
  readonly id: string;
  readonly cardId: string;
  readonly sourceAnchorId?: string;
}

export interface BlueprintPityState {
  organization: number;
  model: number;
  knowledge: number;
}

export interface StatusState {
  readonly id: StatusId;
  readonly sourceId: string;
  remainingTurns: number;
  pending: boolean;
}

export interface AnchorState {
  readonly id: string;
  readonly ownerSeatId: string;
  readonly organizationCardId: string | null;
  readonly cardInstanceId: string | null;
  readonly isHomeLab: boolean;
  readonly slotIndex: number | null;
  readonly assetInstanceIds: string[];
  readonly statuses: StatusState[];
}

export interface AssetState {
  readonly instanceId: string;
  readonly cardId: string;
  readonly ownerSeatId: string;
  anchorId: string;
  attachedModelInstanceId?: string;
  readonly statuses: StatusState[];
  lastParticipatedRound: number | null;
}

export interface TimedModifier {
  readonly id: string;
  readonly sourceCardId: string;
  readonly effect: Effect;
  readonly expiresAtRound: number;
  readonly targetAnchorId?: string;
  readonly targetModelInstanceId?: string;
}

export interface PendingTechCheck {
  readonly actionInstanceId: string;
  readonly actionCardId: string;
  readonly casterSeatId: string;
  readonly targetAnchorId?: string;
  readonly targetModelInstanceId?: string;
  readonly benchmarkModelInstanceId?: string;
  readonly statusReplacementId?: StatusId;
  readonly finalCost: {
    readonly compute: number;
    readonly capital: number;
  };
}

export interface PlayerState {
  readonly seatId: string;
  readonly displayName: string;
  readonly faction: ConsortiumFaction;
  readonly doctrineId: string;
  readonly signatureActionIds: readonly string[];
  influence: number;
  capital: number;
  compute: number;
  turnNumber: number;
  influenceGainedThisRound: number;
  influenceSourceIdsThisRound: string[];
  blueprintDeck: string[];
  blueprintHand: string[];
  blueprintArchive: string[];
  blueprintPity: BlueprintPityState;
  actionHand: ActionInstance[];
  actionArchive: string[];
  mulliganReady: boolean;
  factionLock: ConsortiumFaction | null;
  organizationDeploysThisTurn: number;
  assetDeploysThisTurn: number;
  benchmarksThisTurn: number;
  techChecksThisTurn: number;
  benchmarkDefenderModelInstanceId: string | null;
  benchmarkWins: number;
  highestBenchmarkScore: number;
  readonly statuses: StatusState[];
  timedModifiers: TimedModifier[];
  nextActionInstanceOrdinal: number;
}

export interface WorldEventState {
  readonly cardId: string;
  readonly startedAtRound: number;
  readonly expiresAfterRound: number;
}

export interface BenchmarkResult {
  readonly type: BenchmarkType;
  readonly ability: Ability;
  readonly challengerSeatId: string;
  readonly challengerModelInstanceId: string;
  readonly challengerBase: number;
  readonly challengerModifiers: readonly {
    readonly source: string;
    readonly amount: number;
  }[];
  readonly challengerScore: number;
  readonly defenderSeatId: string;
  readonly defenderModelInstanceId: string | null;
  readonly defenderSelection: "assigned" | "automatic" | "none";
  readonly defenderBase: number | null;
  readonly defenderModifiers: readonly {
    readonly source: string;
    readonly amount: number;
  }[];
  readonly defenderScore: number | null;
  readonly scoreDifference: number | null;
  readonly threshold: number;
  readonly pressureTurnsApplied: number | null;
  readonly winnerSeatId: string | null;
  readonly tied: boolean;
}

export interface MatchState {
  readonly gameId: string;
  readonly seats: readonly [string, string];
  readonly firstSeatId: string;
  activeSeatId: string | null;
  phase: MatchPhase;
  round: number;
  turnOrderIndex: 0 | 1;
  players: Record<string, PlayerState>;
  cardInstances: Record<string, CardInstance>;
  anchors: Record<string, AnchorState>;
  assets: Record<string, AssetState>;
  worldEvent: WorldEventState | null;
  worldEventQueue: string[];
  pendingTechCheck: PendingTechCheck | null;
  lastBenchmark: BenchmarkResult | null;
  winnerSeatId: string | null;
  isDraw: boolean;
  finishReason: MatchFinishReason;
  nextEntityOrdinal: number;
}

export type ModelMayhemCommand =
  | {
      readonly kind: "mulligan";
      readonly cardInstanceIds: readonly string[];
    }
  | {
      readonly kind: "deploy_organization";
      readonly cardInstanceId: string;
      readonly slotIndex: number;
    }
  | {
      readonly kind: "deploy_asset";
      readonly cardInstanceId: string;
      readonly anchorId: string;
      readonly attachedModelInstanceId?: string;
    }
  | {
      readonly kind: "play_action";
      readonly actionInstanceId: string;
      readonly targetAnchorId?: string;
      readonly targetModelInstanceId?: string;
      readonly benchmarkModelInstanceId?: string;
      readonly statusReplacementId?: StatusId;
    }
  | {
      readonly kind: "discard_action";
      readonly actionInstanceId: string;
    }
  | {
      readonly kind: "discard_blueprint";
      readonly cardInstanceId: string;
    }
  | {
      readonly kind: "set_benchmark_defender";
      readonly modelInstanceId: string | null;
    }
  | {
      readonly kind: "resolve_tech_check";
      readonly optionId: string;
    }
  | {
      readonly kind: "end_turn";
    }
  | {
      readonly kind: "surrender";
    };

export interface ModelMayhemEventPayloadMap {
  readonly match_started: {
    readonly firstSeatId: string;
  };
  readonly mulligan_confirmed: {
    readonly seatId: string;
    readonly returnedCount: number;
  };
  readonly round_started: {
    readonly round: number;
  };
  readonly world_event_started: {
    readonly cardId: string;
    readonly expiresAfterRound: number;
  };
  readonly turn_started: {
    readonly seatId: string;
    readonly round: number;
    readonly turnNumber: number;
  };
  readonly blueprint_drawn: {
    readonly seatId: string;
    readonly cardInstanceId: string;
    readonly cardId: string;
  };
  readonly blueprint_pity_triggered: {
    readonly seatId: string;
    readonly category: "organization" | "model" | "knowledge";
    readonly cardId: string;
  };
  readonly blueprint_discarded: {
    readonly seatId: string;
    readonly cardInstanceId: string;
    readonly cardId: string;
    readonly remaining: number;
  };
  readonly action_drawn: {
    readonly seatId: string;
    readonly actionInstanceId: string;
    readonly cardId: string;
    readonly sourceAnchorId?: string;
  };
  readonly action_discarded: {
    readonly seatId: string;
    readonly actionInstanceId: string;
    readonly cardId: string;
    readonly remaining: number;
  };
  readonly draw_skipped: {
    readonly seatId: string;
    readonly deck: "blueprint" | "action";
    readonly reason: "hand_limit" | "empty";
  };
  readonly organization_deployed: {
    readonly seatId: string;
    readonly cardId: string;
    readonly anchorId: string;
    readonly slotIndex: number;
    readonly finalCost: { readonly compute: number; readonly capital: number };
  };
  readonly asset_deployed: {
    readonly seatId: string;
    readonly cardId: string;
    readonly assetInstanceId: string;
    readonly anchorId: string;
    readonly finalCost: { readonly compute: number; readonly capital: number };
  };
  readonly action_played: {
    readonly seatId: string;
    readonly cardId: string;
    readonly actionInstanceId: string;
    readonly finalCost: { readonly compute: number; readonly capital: number };
  };
  readonly effect_attack_resolved: {
    readonly sourceSeatId: string;
    readonly targetSeatId: string;
    readonly attackType: EffectAttackType;
    readonly targetId: string;
    readonly amount: number;
  };
  readonly influence_gained: {
    readonly seatId: string;
    readonly amount: number;
    readonly sourceCardId: string;
    readonly total: number;
  };
  readonly influence_stolen: {
    readonly winnerSeatId: string;
    readonly loserSeatId: string;
    readonly amount: number;
    readonly winnerTotal: number;
    readonly loserTotal: number;
  };
  readonly benchmark_resolved: BenchmarkResult;
  readonly status_granted: {
    readonly targetId: string;
    readonly status: StatusId;
  };
  readonly status_removed: {
    readonly targetId: string;
    readonly status: StatusId;
    readonly reason: "effect" | "expired" | "consumed" | "replaced";
  };
  readonly tech_check_started: {
    readonly seatId: string;
    readonly actionCardId: string;
    readonly questionId: string;
  };
  readonly tech_check_resolved: {
    readonly seatId: string;
    readonly actionCardId: string;
    readonly optionId: string;
    readonly correct: boolean;
  };
  readonly benchmark_defender_set: {
    readonly seatId: string;
    readonly modelInstanceId: string | null;
  };
  readonly turn_ended: {
    readonly seatId: string;
    readonly round: number;
  };
  readonly match_finished: {
    readonly winnerSeatId: string | null;
    readonly isDraw: boolean;
    readonly reason: Exclude<MatchFinishReason, null>;
  };
}

export type ModelMayhemEventType = keyof ModelMayhemEventPayloadMap;
export type ModelMayhemEventPayload = ModelMayhemEventPayloadMap[ModelMayhemEventType];

export interface PublicPlayerView {
  readonly seatId: string;
  readonly displayName: string;
  readonly faction: ConsortiumFaction;
  readonly doctrineId: string;
  readonly influence: number;
  readonly capital: number;
  readonly compute: number;
  readonly blueprintHandCount: number;
  readonly blueprintHandOverflow: number;
  readonly actionHandCount: number;
  readonly actionHandOverflow: number;
  readonly blueprintDeckCount: number;
  readonly anchors: readonly AnchorView[];
  readonly assets: readonly AssetView[];
  readonly benchmarkWins: number;
  readonly highestBenchmarkScore: number;
  readonly factionLock: ConsortiumFaction | null;
  readonly mulliganReady: boolean;
  readonly turnNumber: number;
  readonly influenceGainedThisRound: number;
  readonly influenceGainRemaining: number;
  readonly organizationDeploysThisTurn: number;
  readonly assetDeploysThisTurn: number;
  readonly benchmarksThisTurn: number;
  readonly techChecksThisTurn: number;
  readonly benchmarkDefenderModelInstanceId: string | null;
  readonly capitalIncome: number;
  readonly nextComputeCeiling: number;
  readonly timedModifiers: readonly TimedModifierView[];
}

export interface PrivatePlayerView extends PublicPlayerView {
  readonly blueprintDeckComposition: readonly {
    readonly cardId: string;
    readonly count: number;
  }[];
  readonly blueprintHand: readonly {
    readonly instanceId: string;
    readonly cardId: string;
  }[];
  readonly actionHand: readonly ActionInstance[];
}

export interface TimedModifierView {
  readonly sourceCardId: string;
  readonly effect: Effect;
  readonly expiresAtRound: number;
  readonly targetAnchorId?: string;
  readonly targetModelInstanceId?: string;
}

export interface WorldEventView {
  readonly cardId: string;
  readonly startedAtRound: number;
  readonly expiresAfterRound: number;
}

export interface AnchorView {
  readonly id: string;
  readonly ownerSeatId: string;
  readonly organizationCardId: string | null;
  readonly isHomeLab: boolean;
  readonly slotIndex: number | null;
  readonly capacity: number;
  readonly statuses: readonly StatusState[];
  readonly assetInstanceIds: readonly string[];
}

export interface AssetView {
  readonly instanceId: string;
  readonly cardId: string;
  readonly ownerSeatId: string;
  readonly anchorId: string;
  readonly attachedModelInstanceId?: string;
  readonly statuses: readonly StatusState[];
  readonly lastParticipatedRound: number | null;
}

export interface ModelMayhemView {
  readonly gameId: string;
  readonly viewerSeatId: string;
  readonly phase: MatchPhase;
  readonly round: number;
  readonly activeSeatId: string | null;
  readonly firstSeatId: string;
  readonly winnerSeatId: string | null;
  readonly isDraw: boolean;
  readonly finishReason: MatchFinishReason;
  readonly me: PrivatePlayerView;
  readonly opponent: PublicPlayerView;
  readonly worldEvent: WorldEventView | null;
  readonly pendingTechCheck: Omit<PendingTechCheck, "finalCost"> | null;
  readonly lastBenchmark: BenchmarkResult | null;
  readonly actionPoolComposition: readonly {
    readonly subtype: string;
    readonly count: number;
  }[];
}

export interface FinalCost {
  readonly compute: number;
  readonly capital: number;
  readonly adjustments: readonly CostAdjustment[];
}

export interface CostAdjustment {
  readonly source: string;
  readonly resource: "compute" | "capital";
  readonly amount: number;
  readonly kind: "card" | "status" | "event" | "capacity" | "target";
}

export interface ActionPreview {
  readonly cardId: string;
  readonly cardName: string;
  readonly cost: FinalCost;
  readonly effects: readonly Effect[];
  readonly baseEffects?: readonly Effect[];
  readonly enhancedEffects?: readonly Effect[];
  readonly questionId?: string;
}

export interface LegalActionBase {
  readonly id: string;
  readonly label: string;
  readonly preview?: ActionPreview;
}

export type LegalAction = LegalActionBase &
  (
    | {
        readonly kind: "mulligan";
        readonly cardInstanceIds: readonly string[];
        readonly label: string;
      }
    | {
        readonly kind: "deploy_organization";
        readonly cardInstanceId: string;
        readonly slotIndex: number;
        readonly label: string;
      }
    | {
        readonly kind: "deploy_asset";
        readonly cardInstanceId: string;
        readonly anchorId: string;
        readonly attachedModelInstanceId?: string;
        readonly label: string;
      }
    | {
        readonly kind: "play_action";
        readonly actionInstanceId: string;
        readonly targetAnchorId?: string;
        readonly targetModelInstanceId?: string;
        readonly benchmarkModelInstanceId?: string;
        readonly statusReplacementId?: StatusId;
        readonly label: string;
      }
    | {
        readonly kind: "discard_action";
        readonly actionInstanceId: string;
        readonly label: string;
      }
    | {
        readonly kind: "discard_blueprint";
        readonly cardInstanceId: string;
        readonly label: string;
      }
    | {
        readonly kind: "set_benchmark_defender";
        readonly modelInstanceId: string | null;
        readonly label: string;
      }
    | {
        readonly kind: "resolve_tech_check";
        readonly optionId: string;
        readonly label: string;
      }
    | {
        readonly kind: "end_turn";
        readonly label: string;
      }
    | {
        readonly kind: "surrender";
        readonly label: string;
      }
  );

export interface ActionResolutionContext {
  readonly action: ActionCard;
  readonly targetAnchorId?: string;
  readonly targetModelInstanceId?: string;
  readonly benchmarkModelInstanceId?: string;
  readonly statusReplacementId?: StatusId;
}

export interface EffectTargets {
  readonly selfSeatId: string;
  readonly opponentSeatId: string;
  readonly selfAnchorId?: string;
  readonly opponentAnchorId?: string;
  readonly selfModelInstanceId?: string;
  readonly opponentModelInstanceId?: string;
  readonly statusReplacementId?: StatusId;
}

export interface ResolvedTarget {
  readonly ownerSeatId: string;
  readonly anchorId?: string;
  readonly modelInstanceId?: string;
}

export interface SelectorCardContext {
  readonly cardId: string;
  readonly type: "organization" | "asset" | "action" | "world_event";
  readonly subtype: string;
  readonly tags: readonly string[];
  readonly openness?: "closed" | "open_weights" | "open_source" | "open_science";
  readonly faction?: "china" | "west" | "global";
  readonly abilities?: readonly Ability[];
}

export interface SelectorContext {
  readonly content: ContentPack;
  readonly selector: CardSelector;
  readonly card: SelectorCardContext;
}

export type ResolveTargetRole = (target: TargetRole) => ResolvedTarget | undefined;
export type ResolveActionTargeting = (rule: TargetingRule) => {
  readonly anchorId?: string;
  readonly modelInstanceId?: string;
};

export interface AssetDeployValidation {
  readonly valid: boolean;
  readonly reason?: string;
}

export interface AnchorCapacity {
  readonly base: number;
  readonly final: number;
}

export interface EngineDependencies {
  readonly content: ContentPack;
}

export interface SimulationResult {
  readonly accepted: boolean;
  readonly events: readonly {
    readonly type: ModelMayhemEventType;
    readonly payload: ModelMayhemEventPayload;
  }[];
  readonly state: MatchState;
  readonly violation?: {
    readonly code: string;
    readonly message: string;
  };
}

export type CardDefinition = ActionCard | AssetCard | Effect;
