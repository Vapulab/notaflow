ALTER TABLE `mail_outbox` ADD `account_id` text;--> statement-breakpoint
ALTER TABLE `mail_outbox` ADD `invoice_id` text;--> statement-breakpoint
CREATE INDEX `mail_outbox_account_invoice` ON `mail_outbox` (`account_id`,`invoice_id`,`created_at`);