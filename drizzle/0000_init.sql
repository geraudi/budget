CREATE TABLE `operations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date_comptabilisation` text NOT NULL,
	`libelle_simplifie` text NOT NULL,
	`libelle_operation` text NOT NULL,
	`reference` text,
	`infos_complementaires` text,
	`type_operation` text,
	`categorie` text,
	`sous_categorie` text,
	`debit` real,
	`credit` real,
	`montant` real NOT NULL,
	`date_operation` text,
	`date_valeur` text,
	`pointage` integer
);
--> statement-breakpoint
CREATE INDEX `idx_ops_libelle` ON `operations` (`libelle_simplifie`);--> statement-breakpoint
CREATE INDEX `idx_ops_date` ON `operations` (`date_comptabilisation`);--> statement-breakpoint
CREATE INDEX `idx_ops_categorie` ON `operations` (`categorie`);