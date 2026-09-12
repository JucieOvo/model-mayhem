/**
 * 系统内容更新、安装与回滚协议。
 *
 * 作者：JucieOvo
 *
 * 这些结构只描述系统级内容状态，不包含玩家档案正文、API Key 或座位令牌。
 */

import { z } from "zod";

export const UpdateChannelSchema = z.enum(["stable", "preview", "custom"]);
export type UpdateChannel = z.infer<typeof UpdateChannelSchema>;

export const InstallModeSchema = z.enum(["official", "sandbox", "community"]);
export type InstallMode = z.infer<typeof InstallModeSchema>;

export const ContentInstallationSchema = z
  .object({
    installationId: z.string().min(1),
    appVersion: z.string().min(1),
    contentVersion: z.string().min(1),
    contentCommit: z.string().min(1),
    contentTreeHash: z.string().regex(/^[a-f0-9]{64}$/),
    contentManifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    contentSchemaVersion: z.number().int().positive(),
    databaseSchemaHash: z.string().regex(/^[a-f0-9]{64}$/),
    lastMigrationId: z.string().min(1),
    installMode: InstallModeSchema,
    knownMods: z.array(z.string().min(1)),
    installedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type ContentInstallation = z.infer<typeof ContentInstallationSchema>;

export const UpdateStatusSchema = z
  .object({
    enabled: z.boolean(),
    repository: z.string().nullable(),
    branch: z.string().nullable(),
    channel: UpdateChannelSchema,
    checkOnStart: z.boolean(),
    autoInstall: z.boolean(),
    active: ContentInstallationSchema.nullable(),
    pendingCommit: z.string().nullable(),
    pendingContentVersion: z.string().nullable(),
    restartRequired: z.boolean(),
    integrity: z.enum(["official", "community", "unknown"]),
    message: z.string().min(1),
  })
  .strict();
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;

export const UpdateCheckResultSchema = z
  .object({
    status: z.literal("up_to_date").or(z.literal("update_available")),
    remoteCommit: z.string().min(1),
    contentVersion: z.string().min(1),
    contentTreeHash: z.string().regex(/^[a-f0-9]{64}$/),
    restartRequired: z.boolean(),
    message: z.string().min(1),
  })
  .strict();
export type UpdateCheckResult = z.infer<typeof UpdateCheckResultSchema>;

export const UpdateInstallResultSchema = z
  .object({
    installed: ContentInstallationSchema,
    previous: ContentInstallationSchema.nullable(),
    restartRequired: z.literal(true),
    message: z.string().min(1),
  })
  .strict();
export type UpdateInstallResult = z.infer<typeof UpdateInstallResultSchema>;

export const UpdateRollbackResultSchema = z
  .object({
    restored: ContentInstallationSchema,
    restartRequired: z.literal(true),
    playerDataRestored: z.boolean(),
    message: z.string().min(1),
  })
  .strict();
export type UpdateRollbackResult = z.infer<typeof UpdateRollbackResultSchema>;

export const DiagnosticSummarySchema = z
  .object({
    appVersion: z.string().min(1),
    contentVersion: z.string().min(1),
    contentCommit: z.string().min(1),
    dataDirectory: z.string().min(1),
    agentRuntimeDirectory: z.string().min(1),
    logDirectory: z.string().min(1),
    deepSeekKeyConfigured: z.boolean(),
    sandboxEnabled: z.boolean(),
    devApiEnabled: z.boolean(),
  })
  .strict();
export type DiagnosticSummary = z.infer<typeof DiagnosticSummarySchema>;
