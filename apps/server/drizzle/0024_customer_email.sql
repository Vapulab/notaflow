ALTER TABLE `emitters` ADD `auto_email_customer` integer DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE `emitters` SET `auto_email_customer` = 0;--> statement-breakpoint
ALTER TABLE `invoices` ADD `customer_emailed_at` integer;
