CREATE TABLE `bug_report_images` (
	`id` text PRIMARY KEY NOT NULL,
	`bug_report_id` text NOT NULL,
	`account_id` text NOT NULL,
	`position` integer NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`r2_key` text NOT NULL,
	`purged_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer,
	`created_by` text,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_by` text,
	FOREIGN KEY (`bug_report_id`) REFERENCES `bug_reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bug_report_images_position` ON `bug_report_images` (`bug_report_id`,`position`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TRIGGER `bug_report_images_no_delete` BEFORE DELETE ON `bug_report_images`
BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;
