-- Business rows are never deleted: removal sets deleted_at. The audit log is append only.
CREATE TRIGGER `accounts_no_delete` BEFORE DELETE ON `accounts`
BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;--> statement-breakpoint
CREATE TRIGGER `users_no_delete` BEFORE DELETE ON `users`
BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;--> statement-breakpoint
CREATE TRIGGER `memberships_no_delete` BEFORE DELETE ON `memberships`
BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;--> statement-breakpoint
CREATE TRIGGER `emitters_no_delete` BEFORE DELETE ON `emitters`
BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;--> statement-breakpoint
CREATE TRIGGER `certificates_no_delete` BEFORE DELETE ON `certificates`
BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;--> statement-breakpoint
CREATE TRIGGER `customers_no_delete` BEFORE DELETE ON `customers`
BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;--> statement-breakpoint
CREATE TRIGGER `services_no_delete` BEFORE DELETE ON `services`
BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;--> statement-breakpoint
CREATE TRIGGER `invoices_no_delete` BEFORE DELETE ON `invoices`
BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;--> statement-breakpoint
CREATE TRIGGER `invoice_events_no_delete` BEFORE DELETE ON `invoice_events`
BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;--> statement-breakpoint
CREATE TRIGGER `sync_state_no_delete` BEFORE DELETE ON `sync_state`
BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;--> statement-breakpoint
CREATE TRIGGER `audit_log_no_update` BEFORE UPDATE ON `audit_log`
BEGIN SELECT RAISE(ABORT, 'audit log is append only'); END;--> statement-breakpoint
CREATE TRIGGER `audit_log_no_delete` BEFORE DELETE ON `audit_log`
BEGIN SELECT RAISE(ABORT, 'audit log is append only'); END;
