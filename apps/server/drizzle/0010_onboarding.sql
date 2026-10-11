CREATE TABLE `account_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`cnpj` text NOT NULL,
	`file_name` text NOT NULL,
	`content_gzip` blob NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer,
	`created_by` text,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_by` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD `onboarding_step` text DEFAULT 'card' NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `cnpj_draft` text;--> statement-breakpoint
ALTER TABLE `users` ADD `tour_seen_at` integer;--> statement-breakpoint
CREATE TRIGGER `account_documents_no_delete` BEFORE DELETE ON `account_documents`
BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;--> statement-breakpoint
-- An account that already issues invoices (it has an emitter) does not go through onboarding.
UPDATE `accounts` SET `onboarding_step` = 'done'
WHERE `id` IN (SELECT `account_id` FROM `emitters` WHERE `deleted_at` IS NULL);