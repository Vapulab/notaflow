// Tables whose rows are never deleted (a <table>_no_delete trigger refuses it); every other table but audit_log must be here.
export const BUSINESS_TABLES = [
  'accounts',
  'users',
  'memberships',
  'emitters',
  'certificates',
  'customers',
  'services',
  'invoices',
  'invoice_events',
  'sync_state',
] as const;

// Append-only or ephemeral tables, outside the soft delete rule (stage 3b adds the auth session tables).
export const OTHER_TABLES = ['audit_log'] as const;
