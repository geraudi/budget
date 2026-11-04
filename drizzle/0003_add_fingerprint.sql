ALTER TABLE `operations` ADD `fingerprint` text;--> statement-breakpoint
CREATE INDEX `idx_ops_fingerprint` ON `operations` (`fingerprint`);