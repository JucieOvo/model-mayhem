/**
 * Model Mayhem SQLite 表结构。
 *
 * 作者：JucieOvo
 *
 * 表结构保存档案、研究进度、收藏、牌组、对局快照、事件和 Agent 轨迹。规则状态
 * 以版本化 JSON 保存，事件日志用于审计与回放。
 */

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  kind: text("kind", { enum: ["official", "sandbox"] })
    .notNull()
    .default("official"),
  faction: text("faction", { enum: ["china", "west"] }),
  researchData: integer("research_data").notNull().default(0),
  completedMatches: integer("completed_matches").notNull().default(0),
  currentEraId: text("current_era_id").notNull().default("gpt3"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const researchProgress = sqliteTable(
  "research_progress",
  {
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    unlockedAt: text("unlocked_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.profileId, table.nodeId],
    }),
  ],
);

export const collection = sqliteTable(
  "collection",
  {
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    cardId: text("card_id").notNull(),
    unlockedAt: text("unlocked_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.profileId, table.cardId],
    }),
  ],
);

export const decks = sqliteTable(
  "decks",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    faction: text("faction", { enum: ["china", "west"] })
      .notNull()
      .default("china"),
    doctrineId: text("doctrine_id").notNull(),
    blueprintJson: text("blueprint_json").notNull(),
    signatureJson: text("signature_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("decks_profile_idx").on(table.profileId)],
);

export const matches = sqliteTable(
  "matches",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    rulesetId: text("ruleset_id").notNull(),
    rulesetVersion: text("ruleset_version").notNull(),
    contentVersion: text("content_version").notNull(),
    seed: integer("seed").notNull(),
    agentDifficulty: text("agent_difficulty", {
      enum: ["trainee", "standard", "adversarial"],
    })
      .notNull()
      .default("standard"),
    status: text("status", { enum: ["playing", "finished"] }).notNull(),
    winnerSeatId: text("winner_seat_id"),
    isDraw: integer("is_draw", { mode: "boolean" }).notNull().default(false),
    finishReason: text("finish_reason"),
    snapshotJson: text("snapshot_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("matches_profile_idx").on(table.profileId)],
);

export const matchEvents = sqliteTable(
  "match_events",
  {
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    eventId: text("event_id").notNull(),
    commandId: text("command_id").notNull(),
    actorSeatId: text("actor_seat_id").notNull(),
    actorKind: text("actor_kind", {
      enum: ["human", "agent", "system"],
    }).notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.matchId, table.sequence],
    }),
    index("match_events_command_idx").on(table.matchId, table.commandId),
  ],
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    seatId: text("seat_id").notNull(),
    agentId: text("agent_id").notNull(),
    eventType: text("event_type").notNull(),
    toolName: text("tool_name"),
    inputJson: text("input_json"),
    outputJson: text("output_json"),
    errorMessage: text("error_message"),
    latencyMs: integer("latency_ms"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("agent_runs_match_idx").on(table.matchId, table.seatId)],
);

export const contentVersions = sqliteTable("content_versions", {
  version: text("version").primaryKey(),
  manifestJson: text("manifest_json").notNull(),
  loadedAt: text("loaded_at").notNull(),
});

export const developerOperations = sqliteTable(
  "developer_operations",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    matchId: text("match_id"),
    command: text("command").notNull(),
    beforeJson: text("before_json").notNull(),
    afterJson: text("after_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("developer_operations_profile_idx").on(table.profileId, table.createdAt)],
);

export const tutorialProgress = sqliteTable("tutorial_progress", {
  profileId: text("profile_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  completedJson: text("completed_json").notNull().default("[]"),
  dismissed: integer("dismissed", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
});
