/**
 * 首次运行与教程进度协议。
 *
 * 作者：JucieOvo
 */

import { z } from "zod";

export const TUTORIAL_STEP_IDS = [
  "faction_selected",
  "deck_confirmed",
  "mulligan_completed",
  "organization_deployed",
  "asset_deployed",
  "action_played",
  "benchmark_completed",
  "research_node_unlocked",
] as const;

export const TutorialStepIdSchema = z.enum(TUTORIAL_STEP_IDS);
export type TutorialStepId = z.infer<typeof TutorialStepIdSchema>;

export const TutorialProgressSchema = z
  .object({
    profileId: z.string().min(1),
    completedSteps: z.array(TutorialStepIdSchema),
    dismissed: z.boolean(),
    updatedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
export type TutorialProgress = z.infer<typeof TutorialProgressSchema>;

export const TutorialAdvanceRequestSchema = z
  .object({
    stepId: TutorialStepIdSchema,
  })
  .strict();
export type TutorialAdvanceRequest = z.infer<typeof TutorialAdvanceRequestSchema>;

export const TutorialMatchAdvanceRequestSchema = z
  .object({
    stepId: z.enum([
      "mulligan_completed",
      "organization_deployed",
      "asset_deployed",
      "action_played",
      "benchmark_completed",
    ]),
  })
  .strict();
export type TutorialMatchAdvanceRequest = z.infer<typeof TutorialMatchAdvanceRequestSchema>;

export const TutorialDismissRequestSchema = z
  .object({
    dismissed: z.boolean(),
  })
  .strict();
export type TutorialDismissRequest = z.infer<typeof TutorialDismissRequestSchema>;
