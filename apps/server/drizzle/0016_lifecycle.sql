CREATE TABLE `lifecycle_emails` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`phase` text NOT NULL,
	`step` integer NOT NULL,
	`variant` text NOT NULL,
	`anchor_at` integer NOT NULL,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lifecycle_emails_once` ON `lifecycle_emails` (`user_id`,`account_id`,`phase`,`step`,`anchor_at`);--> statement-breakpoint
CREATE TABLE `policy_notice_views` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`notice_id` text NOT NULL,
	`seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `policy_notice_views_once` ON `policy_notice_views` (`user_id`,`notice_id`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `onboarding_done_at` integer;--> statement-breakpoint
ALTER TABLE `mail_outbox` ADD `reply_to` text;--> statement-breakpoint
ALTER TABLE `mail_outbox` ADD `headers` text;--> statement-breakpoint
ALTER TABLE `users` ADD `lifecycle_opt_out_at` integer;
--> statement-breakpoint
UPDATE `accounts` SET `onboarding_done_at` = (SELECT MIN(`created_at`) FROM `emitters` WHERE `emitters`.`account_id` = `accounts`.`id`) WHERE `onboarding_step` = 'done';--> statement-breakpoint
CREATE TRIGGER `lifecycle_emails_no_update` BEFORE UPDATE ON `lifecycle_emails`
BEGIN SELECT RAISE(ABORT, 'lifecycle e-mails are append only'); END;--> statement-breakpoint
CREATE TRIGGER `lifecycle_emails_no_delete` BEFORE DELETE ON `lifecycle_emails`
BEGIN SELECT RAISE(ABORT, 'lifecycle e-mails are append only'); END;--> statement-breakpoint
CREATE TRIGGER `policy_notice_views_no_update` BEFORE UPDATE ON `policy_notice_views`
BEGIN SELECT RAISE(ABORT, 'policy notice views are append only'); END;--> statement-breakpoint
CREATE TRIGGER `policy_notice_views_no_delete` BEFORE DELETE ON `policy_notice_views`
BEGIN SELECT RAISE(ABORT, 'policy notice views are append only'); END;