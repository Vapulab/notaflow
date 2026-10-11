import { sql } from 'drizzle-orm';
import { blob, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Business tables are never deleted from (a trigger refuses it): removal sets deleted_at.
// A migration that rebuilds a table must recreate its <table>_no_delete trigger; a test checks it.
const id = () => text('id').primaryKey();
const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

// Who and when for a business row; a null *_by means the system (the sync, the scheduler).
const changedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date());
const authors = () => ({ createdBy: text('created_by'), updatedBy: text('updated_by') });
const removal = () => ({
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  deletedBy: text('deleted_by'),
});
const active = sql`deleted_at IS NULL`;

export const accounts = sqliteTable('accounts', {
  id: id(),
  name: text('name').notNull(),
  status: text('status', { enum: ['active', 'suspended'] })
    .notNull()
    .default('active'),
  plan: text('plan').notNull().default(''),
  createdAt: createdAt(),
  updatedAt: changedAt(),
  ...authors(),
  ...removal(),
});

export const users = sqliteTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    platformRole: text('platform_role', { enum: ['admin', 'user'] })
      .notNull()
      .default('user'),
    lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: changedAt(),
    ...authors(),
    ...removal(),
  },
  (table) => [uniqueIndex('users_email_active').on(table.email).where(active)],
);

export const memberships = sqliteTable(
  'memberships',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    createdAt: createdAt(),
    updatedAt: changedAt(),
    ...authors(),
    ...removal(),
  },
  (table) => [
    uniqueIndex('memberships_user_account').on(table.userId, table.accountId).where(active),
  ],
);

export const emitters = sqliteTable(
  'emitters',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    cnpj: text('cnpj').notNull(),
    companyName: text('company_name').notNull(),
    municipalRegistration: text('municipal_registration'),
    municipality: text('municipality').notNull(),
    simplesNacional: text('simples_nacional', { enum: ['1', '2', '3'] }).notNull(),
    simplesRegime: text('simples_regime', { enum: ['1', '2', '3'] }),
    specialRegime: text('special_regime').notNull(),
    provider: text('provider', { enum: ['nacional'] })
      .notNull()
      .default('nacional'),
    environment: text('environment', { enum: ['producao', 'producao_restrita'] })
      .notNull()
      .default('producao_restrita'),
    dpsSeries: text('dps_series').notNull(),
    nextDpsNumber: integer('next_dps_number').notNull().default(1),
    // Percents are integers in hundredths (6.00% = 600), like amounts in cents.
    simplesAnnex: text('simples_annex', { enum: ['III', 'V'] }),
    simplesBand: integer('simples_band'),
    simplesPercent: integer('simples_percent'),
    issRate: integer('iss_rate'),
    ibscbsRegime: text('ibscbs_regime', { enum: ['inside_das', 'regular'] })
      .notNull()
      .default('inside_das'),
    ibscbsRegimeFrom: text('ibscbs_regime_from'),
    createdAt: createdAt(),
    updatedAt: changedAt(),
    ...authors(),
    ...removal(),
  },
  (table) => [uniqueIndex('emitters_cnpj_active').on(table.cnpj).where(active)],
);

export const certificates = sqliteTable('certificates', {
  id: id(),
  emitterId: text('emitter_id')
    .notNull()
    .references(() => emitters.id),
  pfxCiphertext: blob('pfx_ciphertext', { mode: 'buffer' }).notNull(),
  passwordCiphertext: blob('password_ciphertext', { mode: 'buffer' }).notNull(),
  wrappedKey: blob('wrapped_key', { mode: 'buffer' }).notNull(),
  cnpj: text('cnpj').notNull(),
  subject: text('subject').notNull(),
  validFrom: integer('valid_from', { mode: 'timestamp_ms' }).notNull(),
  validTo: integer('valid_to', { mode: 'timestamp_ms' }).notNull(),
  fingerprintSha256: text('fingerprint_sha256').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull(),
  uploadedBy: text('uploaded_by')
    .notNull()
    .references(() => users.id),
  uploadedAt: createdAt(),
  updatedAt: changedAt(),
  ...authors(),
  ...removal(),
});

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userEmail: text('user_email').notNull(),
  accountId: text('account_id'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  result: text('result', { enum: ['ok', 'refused', 'error'] }).notNull(),
  detail: text('detail'),
  at: createdAt(),
});

export const customers = sqliteTable(
  'customers',
  {
    id: id(),
    emitterId: text('emitter_id')
      .notNull()
      .references(() => emitters.id),
    documentType: text('document_type', { enum: ['CNPJ', 'CPF', 'NIF', 'NONE'] }).notNull(),
    document: text('document'),
    name: text('name').notNull(),
    municipalRegistration: text('municipal_registration'),
    address: text('address', { mode: 'json' }),
    email: text('email'),
    phone: text('phone'),
    origin: text('origin', { enum: ['manual', 'imported'] }).notNull(),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    manualFields: text('manual_fields', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...authors(),
    ...removal(),
  },
  (table) => [
    uniqueIndex('customers_emitter_document')
      .on(table.emitterId, table.documentType, table.document)
      .where(active),
  ],
);

export const services = sqliteTable(
  'services',
  {
    id: id(),
    emitterId: text('emitter_id')
      .notNull()
      .references(() => emitters.id),
    name: text('name').notNull(),
    nationalTaxCode: text('national_tax_code').notNull(),
    municipalTaxCode: text('municipal_tax_code'),
    nbsCode: text('nbs_code'),
    description: text('description').notNull(),
    pisCofinsCst: text('pis_cofins_cst'),
    ibscbsOperationCode: text('ibscbs_operation_code'),
    ibscbsCst: text('ibscbs_cst'),
    ibscbsClassCode: text('ibscbs_class_code'),
    exportMode: text('export_mode'),
    exportProviderLink: text('export_provider_link'),
    exportProviderSupport: text('export_provider_support'),
    exportCustomerSupport: text('export_customer_support'),
    exportTemporaryGoods: text('export_temporary_goods'),
    exportMdic: text('export_mdic'),
    origin: text('origin', { enum: ['manual', 'imported'] }).notNull(),
    // Code and description at import time; a hand edit keeps it, so the sync never re-imports.
    importKey: text('import_key'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...authors(),
    ...removal(),
  },
  (table) => [
    uniqueIndex('services_emitter_import_key').on(table.emitterId, table.importKey).where(active),
  ],
);

export const invoices = sqliteTable(
  'invoices',
  {
    id: id(),
    emitterId: text('emitter_id')
      .notNull()
      .references(() => emitters.id),
    customerId: text('customer_id').references(() => customers.id),
    accessKey: text('access_key').unique(),
    number: text('number'),
    dpsId: text('dps_id'),
    dpsSeries: text('dps_series').notNull(),
    dpsNumber: integer('dps_number').notNull(),
    status: text('status', {
      enum: ['pending', 'issued', 'rejected', 'unknown', 'cancelled'],
    }).notNull(),
    environment: text('environment', { enum: ['producao', 'producao_restrita'] }).notNull(),
    issuedAt: integer('issued_at', { mode: 'timestamp_ms' }),
    competence: text('competence').notNull(),
    customerDocument: text('customer_document'),
    customerName: text('customer_name'),
    serviceCode: text('service_code').notNull(),
    description: text('description').notNull(),
    serviceCents: integer('service_cents').notNull(),
    // Export invoices issued by the app: a resend of the same DPS needs the same amount.
    foreignAmountCents: integer('foreign_amount_cents'),
    issCents: integer('iss_cents'),
    netCents: integer('net_cents').notNull(),
    origin: text('origin', { enum: ['synced', 'app'] }).notNull(),
    templateOf: text('template_of'),
    // The built DpsTemplate (JSON) of an invoice issued without a stored template.
    issueTemplate: text('issue_template'),
    // Sent by the issue form; a repeat of the same key answers the first row.
    idempotencyKey: text('idempotency_key'),
    xmlGzip: blob('xml_gzip', { mode: 'buffer' }),
    sefinMessages: text('sefin_messages', { mode: 'json' }),
    createdBy: text('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: text('updated_by'),
    ...removal(),
  },
  (table) => [
    uniqueIndex('invoices_emitter_idempotency_key').on(table.emitterId, table.idempotencyKey),
  ],
);

export const invoiceEvents = sqliteTable(
  'invoice_events',
  {
    id: id(),
    emitterId: text('emitter_id')
      .notNull()
      .references(() => emitters.id),
    invoiceId: text('invoice_id').references(() => invoices.id),
    accessKey: text('access_key').notNull(),
    code: text('code').notNull(),
    reasonCode: text('reason_code'),
    justification: text('justification'),
    registeredAt: integer('registered_at', { mode: 'timestamp_ms' }).notNull(),
    xmlGzip: blob('xml_gzip', { mode: 'buffer' }).notNull(),
    createdBy: text('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: changedAt(),
    updatedBy: text('updated_by'),
    ...removal(),
  },
  (table) => [uniqueIndex('invoice_events_key_code').on(table.accessKey, table.code)],
);

export const syncState = sqliteTable(
  'sync_state',
  {
    emitterId: text('emitter_id')
      .notNull()
      .references(() => emitters.id),
    environment: text('environment', { enum: ['producao', 'producao_restrita'] }).notNull(),
    lastNsu: integer('last_nsu').notNull().default(0),
    lastRunAt: integer('last_run_at', { mode: 'timestamp_ms' }),
    lastSuccessAt: integer('last_success_at', { mode: 'timestamp_ms' }),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
    updatedAt: changedAt(),
    ...authors(),
    ...removal(),
  },
  (table) => [primaryKey({ columns: [table.emitterId, table.environment] })],
);
