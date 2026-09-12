/**
 * 官方沙盒与开发者作弊协议。
 *
 * 作者：JucieOvo
 *
 * 命令只描述允许的开发者动作，不包含任意 SQL、文件路径、进程命令或密钥。
 */

import { z } from "zod";
import { MatchIdSchema } from "./api";

const PositiveGrantSchema = z.number().int().min(1).max(1_000_000_000);
const SignedAmountSchema = z.number().int().min(-1_000_000_000).max(1_000_000_000);

export const SandboxCommandSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("set_faction"),
      faction: z.enum(["china", "west"]),
    })
    .strict(),
  z.object({ kind: z.literal("unlock_all_cards") }).strict(),
  z.object({ kind: z.literal("unlock_all_research") }).strict(),
  z.object({ kind: z.literal("complete_current_era") }).strict(),
  z
    .object({
      kind: z.literal("grant_research_data"),
      amount: PositiveGrantSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("grant_match_resource"),
      matchId: MatchIdSchema,
      resource: z.enum(["compute", "capital", "influence"]),
      amount: SignedAmountSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("set_match_influence"),
      matchId: MatchIdSchema,
      amount: z.number().int().min(0).max(999),
    })
    .strict(),
  z
    .object({
      kind: z.literal("grant_card"),
      cardId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("complete_research_node"),
      nodeId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("force_world_event"),
      matchId: MatchIdSchema,
      cardId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("set_round"),
      matchId: MatchIdSchema,
      round: z.number().int().min(1).max(99),
    })
    .strict(),
  z
    .object({
      kind: z.literal("reveal_opponent"),
      matchId: MatchIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("instant_win"),
      matchId: MatchIdSchema,
    })
    .strict(),
  z.object({ kind: z.literal("reset_sandbox") }).strict(),
]);
export type SandboxCommand = z.infer<typeof SandboxCommandSchema>;

export const SandboxStatusSchema = z
  .object({
    enabled: z.boolean(),
    remoteEnabled: z.boolean(),
    profileId: z.string().min(1),
    faction: z.enum(["china", "west"]).nullable(),
    researchData: z.number().int(),
    completedMatches: z.number().int(),
    collectionCount: z.number().int(),
    unlockedResearchCount: z.number().int(),
  })
  .strict();
export type SandboxStatus = z.infer<typeof SandboxStatusSchema>;

export const SandboxCommandResultSchema = z
  .object({
    accepted: z.literal(true),
    kind: z.string().min(1),
    before: z.unknown(),
    after: z.unknown(),
    message: z.string().min(1),
  })
  .strict();
export type SandboxCommandResult = z.infer<typeof SandboxCommandResultSchema>;
