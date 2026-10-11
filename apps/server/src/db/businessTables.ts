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

// Append-only, or credentials that Better Auth deletes on expiry, sign-out, unlink, or removal.
export const OTHER_TABLES = [
  'audit_log',
  'auth_sessions',
  'auth_accounts',
  'auth_verifications',
  'auth_passkeys',
] as const;
