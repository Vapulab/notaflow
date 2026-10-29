ALTER TABLE `mail_outbox` ADD `provider_id` text;--> statement-breakpoint
ALTER TABLE `mail_outbox` ADD `delivery` text;--> statement-breakpoint
CREATE INDEX `mail_outbox_provider_id` ON `mail_outbox` (`provider_id`);--> statement-breakpoint
ALTER TABLE `mail_suppressions` ADD `reason` text DEFAULT 'unsubscribe' NOT NULL;