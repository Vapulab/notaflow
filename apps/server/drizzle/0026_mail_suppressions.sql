CREATE TABLE `mail_suppressions` (
	`id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer,
	`created_by` text,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_suppressions_address_kind` ON `mail_suppressions` (`address`,`kind`) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE TRIGGER `mail_suppressions_no_delete` BEFORE DELETE ON `mail_suppressions`
BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;
