CREATE TABLE `invoice_links` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`token` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer,
	`created_by` text,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_by` text,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_links_token_unique` ON `invoice_links` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_links_invoice` ON `invoice_links` (`invoice_id`) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE TRIGGER `invoice_links_no_delete` BEFORE DELETE ON `invoice_links`
BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;
