/**
 * Model Mayhem 命令运行期校验。
 *
 * 作者：JucieOvo
 *
 * 服务端和工具客户端在进入规则层前使用该结构校验请求，避免未知命令或错误字段
 * 进入确定性状态机。
 */

import { StatusIdSchema } from "@modelmayhem/model-mayhem-content";
import { z } from "zod";
import type { ModelMayhemCommand } from "./types";

export const ModelMayhemCommandInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("mulligan"),
      cardInstanceIds: z.array(z.string().min(1)).max(5),
    })
    .strict(),
  z
    .object({
      kind: z.literal("deploy_organization"),
      cardInstanceId: z.string().min(1),
      slotIndex: z.number().int().min(0).max(8),
    })
    .strict(),
  z
    .object({
      kind: z.literal("deploy_asset"),
      cardInstanceId: z.string().min(1),
      anchorId: z.string().min(1),
      attachedModelInstanceId: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("play_action"),
      actionInstanceId: z.string().min(1),
      targetAnchorId: z.string().min(1).optional(),
      targetModelInstanceId: z.string().min(1).optional(),
      benchmarkModelInstanceId: z.string().min(1).optional(),
      statusReplacementId: StatusIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("discard_action"),
      actionInstanceId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("discard_blueprint"),
      cardInstanceId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("set_benchmark_defender"),
      modelInstanceId: z.string().min(1).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("resolve_tech_check"),
      optionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("end_turn"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("surrender"),
    })
    .strict(),
]);
export type ModelMayhemCommandInput = z.input<typeof ModelMayhemCommandInputSchema>;

export const ModelMayhemCommandSchema = ModelMayhemCommandInputSchema.transform(
  (value) => value as ModelMayhemCommand,
);
