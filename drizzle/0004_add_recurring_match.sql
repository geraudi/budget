ALTER TABLE `recurring_operations` ADD `match_mode` text DEFAULT 'exact' NOT NULL;--> statement-breakpoint
ALTER TABLE `recurring_operations` ADD `match_pattern` text;