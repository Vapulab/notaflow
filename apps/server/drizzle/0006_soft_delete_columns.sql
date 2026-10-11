DROP INDEX `emitters_cnpj_unique`;--> statement-breakpoint
ALTER TABLE `emitters` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `emitters` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `emitters` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `emitters` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `emitters` ADD `deleted_by` text;--> statement-breakpoint
CREATE UNIQUE INDEX `emitters_cnpj_active` ON `emitters` (`cnpj`) WHERE deleted_at IS NULL;--> statement-breakpoint
DROP INDEX `users_email_unique`;--> statement-breakpoint
ALTER TABLE `users` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `users` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `users` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `deleted_by` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_active` ON `users` (`email`) WHERE deleted_at IS NULL;--> statement-breakpoint
DROP INDEX `customers_emitter_document`;--> statement-breakpoint
ALTER TABLE `customers` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `customers` ADD `deleted_by` text;--> statement-breakpoint
CREATE UNIQUE INDEX `customers_emitter_document` ON `customers` (`emitter_id`,`document_type`,`document`) WHERE deleted_at IS NULL;--> statement-breakpoint
DROP INDEX `memberships_user_account`;--> statement-breakpoint
ALTER TABLE `memberships` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `memberships` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `memberships` ADD `deleted_by` text;--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_user_account` ON `memberships` (`user_id`,`account_id`) WHERE deleted_at IS NULL;--> statement-breakpoint
DROP INDEX `services_emitter_import_key`;--> statement-breakpoint
ALTER TABLE `services` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `services` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `services` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `services` ADD `deleted_by` text;--> statement-breakpoint
CREATE UNIQUE INDEX `services_emitter_import_key` ON `services` (`emitter_id`,`import_key`) WHERE deleted_at IS NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `certificates` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `certificates` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `certificates` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `certificates` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `certificates` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `invoice_events` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `invoice_events` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `invoice_events` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `invoice_events` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `invoices` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `created_at` integer;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `deleted_by` text;--> statement-breakpoint
UPDATE `accounts` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `users` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `memberships` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `emitters` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `invoice_events` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `certificates` SET `updated_at` = `created_at`, `created_by` = `uploaded_by` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `invoices` SET `updated_by` = `created_by` WHERE `updated_by` IS NULL;--> statement-breakpoint
UPDATE `sync_state` SET `created_at` = coalesce(`last_run_at`, unixepoch() * 1000), `updated_at` = coalesce(`last_run_at`, unixepoch() * 1000) WHERE `created_at` IS NULL;
