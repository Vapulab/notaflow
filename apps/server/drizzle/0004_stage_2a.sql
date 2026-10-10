CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`emitter_id` text NOT NULL,
	`name` text NOT NULL,
	`national_tax_code` text NOT NULL,
	`municipal_tax_code` text,
	`nbs_code` text,
	`description` text NOT NULL,
	`pis_cofins_cst` text,
	`ibscbs_operation_code` text,
	`ibscbs_cst` text,
	`ibscbs_class_code` text,
	`export_mode` text,
	`export_provider_link` text,
	`export_provider_support` text,
	`export_customer_support` text,
	`export_temporary_goods` text,
	`export_mdic` text,
	`origin` text NOT NULL,
	`import_key` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`emitter_id`) REFERENCES `emitters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `services_emitter_import_key` ON `services` (`emitter_id`,`import_key`);--> statement-breakpoint
ALTER TABLE `emitters` ADD `simples_annex` text;--> statement-breakpoint
ALTER TABLE `emitters` ADD `simples_band` integer;--> statement-breakpoint
ALTER TABLE `emitters` ADD `simples_percent` integer;--> statement-breakpoint
ALTER TABLE `emitters` ADD `iss_rate` integer;--> statement-breakpoint
ALTER TABLE `emitters` ADD `ibscbs_regime` text DEFAULT 'inside_das' NOT NULL;--> statement-breakpoint
ALTER TABLE `emitters` ADD `ibscbs_regime_from` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `issue_template` text;