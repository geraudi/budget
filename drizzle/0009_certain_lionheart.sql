CREATE TABLE `coach_recommendations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`period_from` text NOT NULL,
	`period_to` text NOT NULL,
	`goal_id` integer,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `financial_goals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_coach_recommendations_period` ON `coach_recommendations` (`period_from`,`period_to`);--> statement-breakpoint
CREATE INDEX `idx_coach_recommendations_goal` ON `coach_recommendations` (`goal_id`);--> statement-breakpoint
CREATE TABLE `financial_goals` (
	`id` integer PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`target_amount` real NOT NULL,
	`saved_amount` real DEFAULT 0 NOT NULL,
	`target_month` text NOT NULL,
	`start_month` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_goals_status` ON `financial_goals` (`status`);--> statement-breakpoint
CREATE INDEX `idx_goals_target_month` ON `financial_goals` (`target_month`);