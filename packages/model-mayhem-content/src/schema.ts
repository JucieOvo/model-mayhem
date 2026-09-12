/**
 * Model Mayhem 内容包结构定义。
 *
 * 作者：JucieOvo
 *
 * 本模块把卡牌、效果、研究节点、预组、平衡参数和技术检定题目定义为
 * 可验证结构。规则执行器只解释这里的结构化字段，不执行自然语言。
 */

import { type ConsortiumFaction, ConsortiumFactionSchema } from "@modelmayhem/contracts";
import { z } from "zod";

export const ContentKindSchema = z.enum(["archive", "community", "meme", "fiction"]);
export type ContentKind = z.infer<typeof ContentKindSchema>;

export const FactionSchema = z.enum(["china", "west", "global"]);
export type Faction = z.infer<typeof FactionSchema>;
export type { ConsortiumFaction };

export const OpennessSchema = z.enum(["closed", "open_weights", "open_source", "open_science"]);
export type Openness = z.infer<typeof OpennessSchema>;

export const AbilitySchema = z.enum(["reasoning", "coding", "agent", "multimodal"]);
export type Ability = z.infer<typeof AbilitySchema>;

export const ResourceSchema = z.enum(["compute", "capital", "influence"]);
export type Resource = z.infer<typeof ResourceSchema>;

export const StatusIdSchema = z.enum([
  "heat",
  "controversy",
  "outage",
  "overload",
  "regulation",
  "training",
  "fortify",
  "momentum",
  "pressure",
]);
export type StatusId = z.infer<typeof StatusIdSchema>;

export const CardTypeSchema = z.enum(["organization", "asset", "action", "world_event"]);
export type CardType = z.infer<typeof CardTypeSchema>;

export const TargetRoleSchema = z.enum([
  "self",
  "opponent",
  "self_active_anchor",
  "opponent_active_anchor",
  "self_active_model",
  "opponent_active_model",
]);
export type TargetRole = z.infer<typeof TargetRoleSchema>;

export const TargetingRuleSchema = z.enum([
  "none",
  "self_anchor",
  "opponent_anchor",
  "self_model",
  "opponent_model",
]);
export type TargetingRule = z.infer<typeof TargetingRuleSchema>;

export const BenchmarkTypeSchema = z.enum(["standard", "competitive", "headline"]);
export type BenchmarkType = z.infer<typeof BenchmarkTypeSchema>;

export const EffectAttackTypeSchema = z.enum([
  "compute_pressure",
  "capital_pressure",
  "score_pressure",
  "status_pressure",
  "cost_pressure",
  "influence_pressure",
]);
export type EffectAttackType = z.infer<typeof EffectAttackTypeSchema>;

export const CostSchema = z
  .object({
    compute: z.number().int().min(0).max(12),
    capital: z.number().int().min(0).max(12),
  })
  .strict();
export type CardCost = z.infer<typeof CostSchema>;

export const CardSelectorSchema = z
  .object({
    cardTypes: z.array(CardTypeSchema).optional(),
    tagsAll: z.array(z.string().min(1)).optional(),
    tagsAny: z.array(z.string().min(1)).optional(),
    openness: z.array(OpennessSchema).optional(),
    factions: z.array(FactionSchema).optional(),
    abilities: z.array(AbilitySchema).optional(),
    subtypes: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type CardSelector = z.infer<typeof CardSelectorSchema>;

export const EffectSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("effect_attack"),
      attackType: EffectAttackTypeSchema,
      target: TargetRoleSchema,
      amount: z.number().int().min(1).max(3).default(1),
      durationTurns: z.number().int().min(1).max(3).default(1),
      status: StatusIdSchema.optional(),
      selector: CardSelectorSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("modify_resource"),
      target: z.enum(["self", "opponent"]),
      resource: z.enum(["compute", "capital"]),
      amount: z.number().int().min(-6).max(6),
    })
    .strict(),
  z
    .object({
      kind: z.literal("gain_influence"),
      target: z.enum(["self", "opponent"]),
      amount: z.number().int().min(0).max(2),
      frequency: z.enum(["resolve", "once_per_round"]).default("resolve"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("steal_influence"),
      amount: z.literal(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("draw"),
      target: z.enum(["self", "opponent"]),
      deck: z.enum(["blueprint", "action"]),
      amount: z.number().int().min(1).max(3),
    })
    .strict(),
  z
    .object({
      kind: z.literal("grant_status"),
      target: TargetRoleSchema,
      status: StatusIdSchema,
      durationTurns: z.number().int().min(0).max(4).default(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("remove_status"),
      target: TargetRoleSchema,
      status: StatusIdSchema,
      maxCount: z.number().int().min(1).max(2).default(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("modify_cost"),
      target: z.enum(["self", "opponent"]),
      resource: z.enum(["compute", "capital"]),
      amount: z.number().int().min(-3).max(3),
      durationRounds: z.number().int().min(1).max(3).default(1),
      selector: CardSelectorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("modify_income"),
      target: z.enum(["self", "opponent"]),
      amount: z.number().int().min(-2).max(2),
      durationRounds: z.number().int().min(1).max(3).default(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("modify_capacity"),
      target: TargetRoleSchema,
      amount: z.number().int().min(-1).max(1),
      durationRounds: z.number().int().min(1).max(3).default(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("modify_model_score"),
      target: z.enum(["self", "opponent"]),
      ability: AbilitySchema.optional(),
      amount: z.number().int().min(-2).max(2),
      durationRounds: z.number().int().min(1).max(3).default(1),
      selector: CardSelectorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("modify_compute_ceiling"),
      target: z.enum(["self", "opponent"]),
      amount: z.number().int().min(-1).max(1),
      durationRounds: z.number().int().min(1).max(3).default(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("benchmark"),
      benchmarkType: BenchmarkTypeSchema,
      ability: AbilitySchema,
      selection: z.enum(["selected", "best"]).default("selected"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("allow_cross_faction_closed"),
      target: z.enum(["self", "opponent"]),
      durationRounds: z.number().int().min(1).max(3).default(1),
    })
    .strict(),
]);
export type Effect = z.infer<typeof EffectSchema>;

export const TriggeredEffectSchema = z
  .object({
    trigger: z.enum([
      "organization_deployed",
      "asset_deployed",
      "model_deployed",
      "technology_installed",
      "turn_started",
      "benchmark_won",
    ]),
    selector: CardSelectorSchema,
    effects: z.array(EffectSchema).min(1),
  })
  .strict();
export type TriggeredEffect = z.infer<typeof TriggeredEffectSchema>;

const SourcesSchema = z.array(z.string().min(1)).min(1);
const ReviewStatusSchema = z.enum(["draft", "playtest", "approved", "retired"]);
const BalanceVersionSchema = z.string().min(1);

const CardBaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_]*$/),
    name: z.string().min(1),
    type: CardTypeSchema,
    subtype: z.string().min(1),
    tags: z.array(z.string().min(1)).default([]),
    cost: CostSchema,
    duration: z.enum(["one_shot", "permanent", "rounds", "target_turns", "consume"]),
    flavor: z.string().min(1),
    description: z.string().min(1).optional(),
    contentKind: ContentKindSchema,
    sources: SourcesSchema,
    balanceVersion: BalanceVersionSchema,
    reviewStatus: ReviewStatusSchema,
    stageId: z.string().min(1).optional(),
    lineageIds: z.array(z.string().min(1)).default([]),
    sourceNodeId: z.string().min(1).optional(),
  })
  .strict();

export const OrganizationCardSchema = CardBaseSchema.extend({
  type: z.literal("organization"),
  subtype: z.enum(["company", "platform", "infrastructure"]),
  faction: FactionSchema,
  openness: OpennessSchema,
  capitalIncome: z.number().int().min(0).max(2),
  capacity: z.number().int().min(2).max(4),
  passiveEffects: z.array(EffectSchema).max(3).default([]),
  triggeredEffects: z.array(TriggeredEffectSchema).max(2).default([]),
  actionSet: z.array(z.string()).length(4),
});
export type OrganizationCard = z.infer<typeof OrganizationCardSchema>;

export const ModelCardSchema = CardBaseSchema.extend({
  type: z.literal("asset"),
  subtype: z.literal("model"),
  assetKind: z.literal("model"),
  abilities: z.object({
    reasoning: z.number().int().min(0).max(5),
    coding: z.number().int().min(0).max(5),
    agent: z.number().int().min(0).max(5),
    multimodal: z.number().int().min(0).max(5),
  }),
  openness: OpennessSchema,
  faction: FactionSchema,
  compatibleOrganizationTags: z.array(z.string().min(1)).default([]),
  deployEffects: z.array(EffectSchema).max(2).default([]),
  passiveEffects: z.array(EffectSchema).max(2).default([]),
});
export type ModelCard = z.infer<typeof ModelCardSchema>;

export const TechnologyCardSchema = CardBaseSchema.extend({
  type: z.literal("asset"),
  subtype: z.enum(["technology", "paper"]),
  assetKind: z.literal("technology"),
  attachment: z.enum(["anchor", "model"]),
  passiveEffects: z.array(EffectSchema).min(1).max(3),
  deployEffects: z.array(EffectSchema).max(2).default([]),
});
export type TechnologyCard = z.infer<typeof TechnologyCardSchema>;

export const AssetCardSchema = z.discriminatedUnion("assetKind", [
  ModelCardSchema,
  TechnologyCardSchema,
]);
export type AssetCard = z.infer<typeof AssetCardSchema>;

export const TechCheckSchema = z
  .object({
    questionId: z.string().min(1),
    baseEffects: z.array(EffectSchema).min(1),
    enhancedEffects: z.array(EffectSchema).min(1),
  })
  .strict();

export const ActionCardSchema = CardBaseSchema.extend({
  type: z.literal("action"),
  subtype: z.enum(["product", "openness", "market", "benchmark", "response", "community"]),
  targeting: TargetingRuleSchema,
  signature: z.boolean().default(false),
  effects: z.array(EffectSchema).max(4),
  techCheck: TechCheckSchema.optional(),
});
export type ActionCard = z.infer<typeof ActionCardSchema>;

export const WorldEventCardSchema = CardBaseSchema.extend({
  type: z.literal("world_event"),
  subtype: z.enum(["hardware", "policy", "market", "research", "community"]),
  durationRounds: z.number().int().min(1).max(3),
  effects: z.array(EffectSchema).min(1).max(3),
});
export type WorldEventCard = z.infer<typeof WorldEventCardSchema>;

export const CardSchema = z.union([
  OrganizationCardSchema,
  AssetCardSchema,
  ActionCardSchema,
  WorldEventCardSchema,
]);
export type Card = z.infer<typeof CardSchema>;

export const BalanceConfigSchema = z
  .object({
    id: z.literal("standard-v0.1"),
    version: z.string().min(1),
    influenceTarget: z.number().int().min(1),
    roundLimit: z.number().int().min(1),
    uniqueCardTarget: z.number().int().min(1),
    blueprintsPerDeck: z.number().int().min(1),
    minimumModelsPerDeck: z.number().int().min(0),
    minimumTechnologiesPerDeck: z.number().int().min(0),
    maxCopiesPerCard: z.number().int().min(1),
    openingBlueprintHand: z.number().int().min(1),
    blueprintDrawPerTurn: z.number().int().min(0),
    blueprintPityDraws: z.number().int().min(1).max(10),
    blueprintHandLimit: z.number().int().min(1),
    openingActionHandFirst: z.number().int().min(0),
    openingActionHandSecond: z.number().int().min(0),
    actionDrawPerTurn: z.number().int().min(0),
    actionHandLimit: z.number().int().min(1),
    anchorSlots: z.number().int().min(1),
    homeLabCapacity: z.number().int().min(1),
    organizationDeploysPerTurn: z.number().int().min(0),
    assetDeploysPerTurn: z.number().int().min(0),
    benchmarksPerTurn: z.number().int().min(0),
    techChecksPerTurn: z.number().int().min(0),
    signatureSlots: z.number().int().min(1),
    capitalBaseIncome: z.number().int().min(0),
    capitalLimit: z.number().int().min(1),
    computeBase: z.number().int().min(1),
    computeLimit: z.number().int().min(1),
    influenceGainPerRoundLimit: z.number().int().min(1),
    costAdjustment: z
      .object({
        minimum: z.number().int().min(-10).max(0),
        maximum: z.number().int().min(0).max(10),
      })
      .strict(),
    modelScore: z
      .object({
        baseMinimum: z.number().int().min(0),
        baseMaximum: z.number().int().min(1),
        modifierMinimum: z.number().int().min(-10).max(0),
        modifierMaximum: z.number().int().min(0).max(10),
        finalMinimum: z.number().int().min(0),
        finalMaximum: z.number().int().min(1),
      })
      .strict(),
    benchmark: z
      .object({
        openBase: z.number().int(),
        openMaximum: z.number().int().min(1),
        openRoundStep: z.number().int().min(1),
        standardGain: z.number().int().min(0),
        competitiveGain: z.number().int().min(0),
        headlineGain: z.number().int().min(0),
        headlineSteal: z.number().int().min(0),
        defeatPressureTurns: z.number().int().min(1),
        heavyDefeatMargin: z.number().int().min(1),
        heavyDefeatPressureTurns: z.number().int().min(1),
      })
      .strict(),
    statusLimitPerAnchor: z.number().int().min(1),
    statusLimitPerModel: z.literal(1),
    worldEventRounds: z.array(z.number().int().min(1)).min(1),
    techCheckSeconds: z.number().int().min(1),
    researchRewards: z
      .object({
        completion: z.number().int().min(0),
        victory: z.number().int().min(0),
        draw: z.number().int().min(0),
        newAccountMatches: z.number().int().min(0),
        newAccountBonus: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();
export type BalanceConfig = z.infer<typeof BalanceConfigSchema>;

export const DeckConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    faction: ConsortiumFactionSchema,
    doctrineId: z.string().min(1),
    blueprintCardIds: z.array(z.string().min(1)),
    signatureActionIds: z.array(z.string().min(1)),
    description: z.string().min(1),
  })
  .strict();
export type DeckConfig = z.infer<typeof DeckConfigSchema>;

export const DoctrineSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    tags: z.array(z.string().min(1)).min(1),
    startingUnlock: z.boolean(),
  })
  .strict();
export type Doctrine = z.infer<typeof DoctrineSchema>;

export const ResearchNodeSchema = z
  .object({
    id: z.string().min(1),
    branch: z.enum(["architecture", "training", "systems", "product"]),
    name: z.string().min(1),
    depth: z.number().int().min(1).max(12),
    cost: z.number().int().min(0),
    prerequisiteId: z.string().min(1).optional(),
    prerequisiteIds: z.array(z.string().min(1)).min(1).optional(),
    prerequisiteMode: z.enum(["all", "any"]).default("all"),
    rewardCardIds: z.array(z.string().min(1)).min(1).max(3),
    rewardDoctrineId: z.string().min(1).optional(),
    description: z.string().min(1),
    stageId: z.string().min(1).optional(),
    completionCategory: z.enum(["paper", "technology", "model"]).optional(),
    lineageIds: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type ResearchNode = z.infer<typeof ResearchNodeSchema>;

export const EraRequirementSchema = z
  .object({
    total: z.number().int().min(0),
    paper: z.number().int().min(0),
    technology: z.number().int().min(0),
    model: z.number().int().min(0),
  })
  .strict();
export type EraRequirement = z.infer<typeof EraRequirementSchema>;

export const EraSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    order: z.number().int().min(0),
    initial: z.boolean().default(false),
    requirements: EraRequirementSchema,
    nextEraId: z.string().min(1).optional(),
  })
  .strict();
export type Era = z.infer<typeof EraSchema>;

export const TechCheckQuestionSchema = z
  .object({
    id: z.string().min(1),
    prompt: z.string().min(1),
    options: z
      .array(
        z
          .object({
            id: z.string().min(1),
            text: z.string().min(1),
          })
          .strict(),
      )
      .length(4),
    correctOptionId: z.string().min(1),
    explanation: z.string().min(1),
    sourceNote: z.string().min(1),
  })
  .strict();
export type TechCheckQuestion = z.infer<typeof TechCheckQuestionSchema>;

export const ContentPackManifestSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    rulesetVersion: z.string().min(1),
    balanceId: z.literal("standard-v0.1"),
    cardIds: z.array(z.string().min(1)),
    eraIds: z.array(z.string().min(1)),
    researchNodeIds: z.array(z.string().min(1)),
    deckIds: z.array(z.string().min(1)),
    questionIds: z.array(z.string().min(1)),
    doctrineIds: z.array(z.string().min(1)),
  })
  .strict();
export type ContentPackManifest = z.infer<typeof ContentPackManifestSchema>;

export const ContentSourceManifestSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    rulesetVersion: z.string().min(1),
    balanceId: z.literal("standard-v0.1"),
  })
  .strict();
export type ContentSourceManifest = z.infer<typeof ContentSourceManifestSchema>;
