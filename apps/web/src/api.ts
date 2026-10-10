export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    // The whole error body, for answers that carry more than a code (Sefin code and message).
    readonly body: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
        }),
  });
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      typeof data === 'object' && data !== null && 'error' in data
        ? String(data.error)
        : `http_${response.status}`;
    throw new ApiError(
      response.status,
      code,
      typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {},
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown, headers?: Record<string, string>) =>
    request<T>('POST', path, body, headers),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
};

export type Environment = 'producao' | 'producao_restrita';

export interface Me {
  userId: string;
  email: string;
  name: string;
  platformRole: 'admin' | 'user';
  accounts: {
    id: string;
    name: string;
    role: 'owner' | 'member';
    status: 'active' | 'suspended';
  }[];
}

export interface Emitter {
  id: string;
  cnpj: string;
  companyName: string;
  environment: Environment;
  municipality: string;
  dpsSeries: string;
  certificate: { validTo: string; expiresSoon: boolean } | null;
}

export interface InvoiceSummary {
  id: string;
  emitterId: string;
  accessKey: string | null;
  number: string | null;
  status: 'pending' | 'issued' | 'rejected' | 'unknown' | 'cancelled';
  environment: Environment;
  issuedAt: string | null;
  competence: string;
  customerDocument: string | null;
  customerName: string | null;
  serviceCode: string;
  description: string;
  serviceCents: number;
  issCents: number | null;
  netCents: number;
}

export interface InvoiceDetail extends InvoiceSummary {
  sefinMessages: { code: string; message: string }[] | null;
  templateOf: string | null;
  events: {
    code: string;
    reasonCode: string | null;
    justification: string | null;
    registeredAt: string;
  }[];
}

export interface InvoicePage {
  items: InvoiceSummary[];
  total: number;
}

export interface SyncState {
  environment: Environment;
  lastNsu: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  running: boolean;
}

export interface SyncResult {
  invoices: number;
  events: number;
  skipped: number;
  lastNsu: number;
  error: string | null;
}

export interface Member {
  userId: string;
  email: string;
  name: string;
  role: 'owner' | 'member';
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  platformRole: 'admin' | 'user';
  lastLoginAt: string | null;
}

export interface AdminAccount {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  plan: string;
  members: number;
}

export interface AuditEntry {
  id: number;
  userEmail: string;
  accountId: string | null;
  action: string;
  entity: string;
  result: 'ok' | 'refused' | 'error';
  detail: string | null;
  at: string;
}

export interface PartyAddress {
  kind: 'domestic' | 'foreign';
  municipality?: string;
  zip?: string;
  country?: string;
  postalCode?: string;
  city?: string;
  region?: string;
  street: string;
  number: string;
  complement?: string;
  district: string;
}

export interface Party {
  document: { type: 'CNPJ' | 'CPF' | 'NIF'; value: string } | null;
  name: string;
}

export interface Draft {
  templateInvoiceId: string;
  emitterId: string;
  competence: string;
  serviceCents: number;
  description: string;
  customer: Party | null;
  foreign: { currency: string; currencyCode: string; amountCents: number } | null;
}

export interface ExchangeRate {
  currency: string;
  date: string;
  rate: string;
  rateE4: number;
  source: string;
}

export interface IssueResult {
  id: string;
  status: InvoiceSummary['status'];
  number?: string;
  accessKey?: string;
  errors?: { code: string; message: string }[];
}

export interface Customer {
  id: string;
  emitterId: string;
  documentType: 'CNPJ' | 'CPF' | 'NIF' | 'NONE';
  document: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  municipalRegistration: string | null;
  address: PartyAddress | null;
  origin: 'manual' | 'imported';
  archived: boolean;
}
