ALTER TABLE `invoices` ADD `pdf_status` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `pdf_mark` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `pdf_enqueued_at` integer;--> statement-breakpoint
ALTER TABLE `invoices` ADD `pdf_rendered_at` integer;--> statement-breakpoint
CREATE INDEX `invoices_pdf_status` ON `invoices` (`pdf_status`);--> statement-breakpoint
UPDATE `invoices` SET `pdf_status` = 'pending' WHERE `xml_gzip` IS NOT NULL;
