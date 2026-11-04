-- Step 2/2: run only after `pnpm seed-categories` has populated
-- category_id / sub_category_id for the existing operations.
DROP INDEX `idx_ops_categorie`;--> statement-breakpoint
ALTER TABLE `operations` DROP COLUMN `categorie`;--> statement-breakpoint
ALTER TABLE `operations` DROP COLUMN `sous_categorie`;