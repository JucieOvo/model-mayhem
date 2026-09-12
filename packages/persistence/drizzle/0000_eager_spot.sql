CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`seat_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`event_type` text NOT NULL,
	`tool_name` text,
	`input_json` text,
	`output_json` text,
	`error_message` text,
	`latency_ms` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_runs_match_idx` ON `agent_runs` (`match_id`,`seat_id`);--> statement-breakpoint
CREATE TABLE `collection` (
	`profile_id` text NOT NULL,
	`card_id` text NOT NULL,
	`unlocked_at` text NOT NULL,
	PRIMARY KEY(`profile_id`, `card_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `content_versions` (
	`version` text PRIMARY KEY NOT NULL,
	`manifest_json` text NOT NULL,
	`loaded_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`name` text NOT NULL,
	`doctrine_id` text NOT NULL,
	`blueprint_json` text NOT NULL,
	`signature_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `decks_profile_idx` ON `decks` (`profile_id`);--> statement-breakpoint
CREATE TABLE `match_events` (
	`match_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_id` text NOT NULL,
	`command_id` text NOT NULL,
	`actor_seat_id` text NOT NULL,
	`actor_kind` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`match_id`, `sequence`),
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `match_events_command_idx` ON `match_events` (`match_id`,`command_id`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`ruleset_id` text NOT NULL,
	`ruleset_version` text NOT NULL,
	`content_version` text NOT NULL,
	`seed` integer NOT NULL,
	`status` text NOT NULL,
	`winner_seat_id` text,
	`is_draw` integer DEFAULT false NOT NULL,
	`finish_reason` text,
	`snapshot_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `matches_profile_idx` ON `matches` (`profile_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`research_data` integer DEFAULT 0 NOT NULL,
	`completed_matches` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_progress` (
	`profile_id` text NOT NULL,
	`node_id` text NOT NULL,
	`unlocked_at` text NOT NULL,
	PRIMARY KEY(`profile_id`, `node_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
