CREATE TABLE `waitlist_signups` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`interests` text NOT NULL,
	`source_page` text NOT NULL,
	`campaign` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer,
	`created_by` text,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_signups_email` ON `waitlist_signups` (`email`) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE TRIGGER `waitlist_signups_no_delete` BEFORE DELETE ON `waitlist_signups`
BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;
