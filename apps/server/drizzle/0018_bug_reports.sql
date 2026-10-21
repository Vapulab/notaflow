CREATE TABLE `bug_report_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bug_report_id` text NOT NULL,
	`kind` text NOT NULL,
	`report_status` text,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`bug_report_id`) REFERENCES `bug_reports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bug_report_deliveries_due` ON `bug_report_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `bug_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`page_path` text NOT NULL,
	`user_agent` text,
	`status` text DEFAULT 'open' NOT NULL,
	`closed_at` integer,
	`github_issue_number` integer,
	`github_issue_url` text,
	`notion_page_id` text,
	`notion_page_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer,
	`created_by` text,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_by` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bug_reports_github_issue` ON `bug_reports` (`github_issue_number`);--> statement-breakpoint
CREATE INDEX `bug_reports_author_time` ON `bug_reports` (`created_by`,`created_at`);--> statement-breakpoint
CREATE TRIGGER `bug_reports_no_delete` BEFORE DELETE ON `bug_reports`
BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;
