CREATE TABLE `invoice_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`emitter_id` text NOT NULL,
	`period_type` text NOT NULL,
	`period_from` text NOT NULL,
	`period_to` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`invoice_count` integer,
	`pages` integer,
	`bytes` integer,
	`error_code` text,
	`r2_key` text,
	`started_at` integer,
	`ready_at` integer,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer,
	`created_by` text,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_by` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`emitter_id`) REFERENCES `emitters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoice_reports_account_created` ON `invoice_reports` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `invoice_reports_status` ON `invoice_reports` (`status`);
--> statement-breakpoint
CREATE TRIGGER `invoice_reports_no_delete` BEFORE DELETE ON `invoice_reports`
BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;
