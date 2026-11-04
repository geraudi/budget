CREATE TABLE `recurring_labels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pattern` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_labels_pattern_unique` ON `recurring_labels` (`pattern`);--> statement-breakpoint
ALTER TABLE `operations` ADD `is_recurring` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_ops_recurring` ON `operations` (`is_recurring`);