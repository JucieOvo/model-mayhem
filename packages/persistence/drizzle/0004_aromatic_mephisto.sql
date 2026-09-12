CREATE TABLE `developer_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`match_id` text,
	`command` text NOT NULL,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `developer_operations_profile_idx` ON `developer_operations` (`profile_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `tutorial_progress` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`completed_json` text DEFAULT '[]' NOT NULL,
	`dismissed` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `profiles` ADD `kind` text DEFAULT 'official' NOT NULL;