CREATE TABLE `category_classification_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`sub_category_id` integer,
	`kind` text NOT NULL,
	`nature` text,
	`confidence` real DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sub_category_id`) REFERENCES `sub_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_classification_rules_sub_unique` ON `category_classification_rules` (`sub_category_id`) WHERE "category_classification_rules"."sub_category_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_classification_rules_category_unique` ON `category_classification_rules` (`category_id`) WHERE "category_classification_rules"."sub_category_id" is null;--> statement-breakpoint
CREATE INDEX `idx_classification_rules_category` ON `category_classification_rules` (`category_id`);--> statement-breakpoint
ALTER TABLE `operations` ADD `kind` text;--> statement-breakpoint
ALTER TABLE `operations` ADD `nature` text;--> statement-breakpoint
ALTER TABLE `operations` ADD `classification_source` text;--> statement-breakpoint
ALTER TABLE `operations` ADD `classification_confidence` real;--> statement-breakpoint
CREATE INDEX `idx_ops_kind` ON `operations` (`kind`);