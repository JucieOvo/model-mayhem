/**
 * 对局服务 HTTP 协议。
 *
 * 作者：JucieOvo
 *
 * 浏览器、Agent SDK 和测试客户端共享这些结构。具体命令正文在进入 Model Mayhem
 * 规则包前继续由命令级 Zod 结构校验。
 */

import { z } from "zod";
import { ConsortiumFactionSchema } from "./primitives";

export const MatchIdSchema = z.string().min(1);
export const SeatIdSchema = z.string().min(1);
export const DeckIdSchema = z.string().min(1);
export const ResearchNodeIdSchema = z.string().min(1);
export const MatchDifficultySchema = z.enum(["trainee", "standard", "adversarial"]);
export type MatchDifficulty = z.infer<typeof MatchDifficultySchema>;

export const HealthResponseSchema = z
  .object({
    status: z.literal("ok"),
    rulesetId: z.string().min(1),
    rulesetVersion: z.string().min(1),
    contentVersion: z.string().min(1),
  })
  .strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const CreateMatchRequestSchema = z
  .object({
    deckId: DeckIdSchema,
    difficulty: MatchDifficultySchema,
    seed: z.number().int().safe().optional(),
    tutorial: z.boolean().optional(),
  })
  .strict();
export type CreateMatchRequest = z.infer<typeof CreateMatchRequestSchema>;

export const CreateMatchResponseSchema = z
  .object({
    matchId: MatchIdSchema,
    playerSeatId: SeatIdSchema,
    seatToken: z.string().min(24),
    view: z.unknown(),
  })
  .strict();
export type CreateMatchResponse = z.infer<typeof CreateMatchResponseSchema>;

export const SubmitCommandRequestSchema = z
  .object({
    commandId: z.string().min(1),
    actionId: z.string().min(1).optional(),
    command: z.unknown().optional(),
  })
  .strict()
  .refine((value) => value.actionId !== undefined || value.command !== undefined, {
    message: "必须提供 actionId 或 command",
  });
export type SubmitCommandRequest = z.infer<typeof SubmitCommandRequestSchema>;

export const SubmitCommandResponseSchema = z
  .object({
    accepted: z.boolean(),
    view: z.unknown(),
    events: z.array(z.unknown()),
    violation: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SubmitCommandResponse = z.infer<typeof SubmitCommandResponseSchema>;

export const UnlockResearchRequestSchema = z
  .object({
    nodeId: ResearchNodeIdSchema,
  })
  .strict();
export type UnlockResearchRequest = z.infer<typeof UnlockResearchRequestSchema>;

export const SaveDeckRequestSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    faction: ConsortiumFactionSchema,
    doctrineId: z.string().min(1),
    blueprintCardIds: z.array(z.string().min(1)),
    signatureActionIds: z.array(z.string().min(1)),
  })
  .strict();
export type SaveDeckRequest = z.infer<typeof SaveDeckRequestSchema>;

export const SetProfileFactionRequestSchema = z
  .object({
    faction: ConsortiumFactionSchema,
  })
  .strict();
export type SetProfileFactionRequest = z.infer<typeof SetProfileFactionRequestSchema>;

export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        details: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const MatchEventEnvelopeSchema = z
  .object({
    matchId: MatchIdSchema,
    sequence: z.number().int().nonnegative(),
    type: z.string().min(1),
    payload: z.unknown(),
  })
  .strict();
export type MatchEventEnvelope = z.infer<typeof MatchEventEnvelopeSchema>;

export const ResearchNodeStatusSchema = z
  .object({
    nodeId: ResearchNodeIdSchema,
    branch: z.enum(["architecture", "training", "systems", "product"]),
    name: z.string().min(1),
    depth: z.number().int().min(1).max(12),
    unlocked: z.boolean(),
    available: z.boolean(),
    cost: z.number().int().nonnegative(),
    rewardCardIds: z.array(z.string()),
    missingResearchData: z.number().int().nonnegative(),
    stageId: z.string().min(1).optional(),
    completionCategory: z.enum(["paper", "technology", "model"]).optional(),
    lineageIds: z.array(z.string()),
    prerequisiteIds: z.array(z.string()),
    prerequisiteMode: z.enum(["all", "any"]),
  })
  .strict();
export type ResearchNodeStatus = z.infer<typeof ResearchNodeStatusSchema>;

export const EraStatusSchema = z
  .object({
    eraId: z.string().min(1),
    name: z.string().min(1),
    order: z.number().int().nonnegative(),
    initial: z.boolean(),
    unlocked: z.boolean(),
  })
  .strict();
export type EraStatus = z.infer<typeof EraStatusSchema>;

export const EraRequirementStatusSchema = z
  .object({
    total: z.number().int().nonnegative(),
    paper: z.number().int().nonnegative(),
    technology: z.number().int().nonnegative(),
    model: z.number().int().nonnegative(),
  })
  .strict();
export type EraRequirementStatus = z.infer<typeof EraRequirementStatusSchema>;

export const TimeAdvanceStatusSchema = z
  .object({
    currentEraId: z.string().min(1),
    nextEraId: z.string().min(1).optional(),
    requirements: EraRequirementStatusSchema,
    completed: EraRequirementStatusSchema,
    canAdvance: z.boolean(),
  })
  .strict();
export type TimeAdvanceStatus = z.infer<typeof TimeAdvanceStatusSchema>;

export const ResearchMapResponseSchema = z
  .object({
    faction: ConsortiumFactionSchema.nullable(),
    researchData: z.number().int().nonnegative(),
    collectionCardIds: z.array(z.string()),
    eras: z.array(EraStatusSchema),
    timeAdvance: TimeAdvanceStatusSchema,
    nodes: z.array(ResearchNodeStatusSchema),
  })
  .strict();
export type ResearchMapResponse = z.infer<typeof ResearchMapResponseSchema>;
