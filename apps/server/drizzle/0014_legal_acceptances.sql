CREATE TABLE `legal_acceptances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`version` text NOT NULL,
	`accepted_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`ip` text,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_acceptances_user_version` ON `legal_acceptances` (`user_id`,`version`);--> statement-breakpoint
CREATE TRIGGER `legal_acceptances_no_update` BEFORE UPDATE ON `legal_acceptances`
BEGIN SELECT RAISE(ABORT, 'legal acceptances are append only'); END;--> statement-breakpoint
CREATE TRIGGER `legal_acceptances_no_delete` BEFORE DELETE ON `legal_acceptances`
BEGIN SELECT RAISE(ABORT, 'legal acceptances are append only'); END;
