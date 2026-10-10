-- Imported services kept the export support mechanisms of their source invoice (02, ACC and public administration); they declare none (01). Lincoln, 2026-10-10.
UPDATE `services` SET `export_provider_support` = '01' WHERE `origin` = 'imported' AND `export_provider_support` IS NOT NULL;--> statement-breakpoint
UPDATE `services` SET `export_customer_support` = '01' WHERE `origin` = 'imported' AND `export_customer_support` IS NOT NULL;
