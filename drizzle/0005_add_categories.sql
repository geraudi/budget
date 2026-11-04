-- Step 1/2: create the category tables and add the operation links,
-- keeping the legacy text columns. Apply this migration, then run
-- `pnpm seed-categories`, and only then apply 0006.
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_categories_normalized_name_unique` ON `categories` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `sub_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sub_categories_category_name_unique` ON `sub_categories` (`category_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `idx_sub_categories_category` ON `sub_categories` (`category_id`);--> statement-breakpoint
ALTER TABLE `operations` ADD `category_id` integer REFERENCES categories(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `operations` ADD `sub_category_id` integer REFERENCES sub_categories(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `idx_ops_category_id` ON `operations` (`category_id`);--> statement-breakpoint
CREATE INDEX `idx_ops_sub_category_id` ON `operations` (`sub_category_id`);