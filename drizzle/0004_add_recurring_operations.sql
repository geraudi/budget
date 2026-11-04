CREATE TABLE `recurring_operations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`libelle_simplifie` text NOT NULL,
	`montant` real NOT NULL,
	`interval_months` integer DEFAULT 1 NOT NULL,
	`first_month` text NOT NULL,
	`duration_type` text DEFAULT 'unlimited' NOT NULL,
	`end_month` text,
	`occurrences` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_recurring_ops_libelle_unique` ON `recurring_operations` (`libelle_simplifie`);--> statement-breakpoint
CREATE INDEX `idx_recurring_ops_first_month` ON `recurring_operations` (`first_month`);