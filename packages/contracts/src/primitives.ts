/**
 * 通用协议基础结构。
 *
 * 作者：JucieOvo
 *
 * 这些结构只描述传输语义，不引入 Model Mayhem 的资源或卡牌字段。
 */

import { z } from "zod";

export const ConsortiumFactionSchema = z.enum(["china", "west"]);
export type ConsortiumFaction = z.infer<typeof ConsortiumFactionSchema>;

/** 返回财团在标准对战中的对立面。 */
export function opposingConsortiumFaction(faction: ConsortiumFaction): ConsortiumFaction {
  return faction === "china" ? "west" : "china";
}

export const UlidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
export type Ulid = z.infer<typeof UlidSchema>;

export const IsoTimestampSchema = z.iso.datetime({ offset: true });
export type IsoTimestamp = z.infer<typeof IsoTimestampSchema>;

export const PaginationSchema = z
  .object({
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict();
export type Pagination = z.infer<typeof PaginationSchema>;

export const JsonRecordSchema = z.record(z.string(), z.unknown());
export type JsonRecord = z.infer<typeof JsonRecordSchema>;
