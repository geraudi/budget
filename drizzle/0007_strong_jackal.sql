CREATE TABLE `events` (
	`global_position` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`stream_id` text NOT NULL,
	`stream_type` text NOT NULL,
	`stream_version` integer NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`metadata` text NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_event_id_unique` ON `events` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_events_stream_version_unique` ON `events` (`stream_id`,`stream_version`);--> statement-breakpoint
CREATE INDEX `idx_events_stream` ON `events` (`stream_id`);--> statement-breakpoint
CREATE INDEX `idx_events_type` ON `events` (`event_type`);--> statement-breakpoint
CREATE TABLE `projection_checkpoints` (
	`name` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sequences` (
	`name` text PRIMARY KEY NOT NULL,
	`next_value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `streams` (
	`stream_id` text PRIMARY KEY NOT NULL,
	`stream_type` text NOT NULL,
	`current_version` integer DEFAULT 0 NOT NULL
);
