import type { InvoiceParty, ProviderEvent, ProviderInvoice } from '../domain/ProviderInvoice';

export interface IssueRequest {
  templateXml: string; // the stored NFS-e the new invoice copies
  series: string;
  number: number;
  issuedAt: Date;
  competence: string; // YYYY-MM-DD
  serviceCents: number;
  foreignAmountCents?: number; // export invoices only
  description?: string;
  customer?: InvoiceParty; // replaces the template's customer
}

// A new invoice built from the emitter, the service, and the customer, with no stored template.
export interface NewInvoiceInput {
  competence: string; // YYYY-MM-DD
  emitter: {
    cnpj: string;
    municipality: string;
    municipalRegistration?: string;
    phone?: string;
    email?: string;
    simplesNacional: '1' | '2' | '3';
    simplesRegime?: '1' | '2' | '3';
    specialRegime: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '9';
  };
  service: {
    nationalTaxCode: string;
    municipalTaxCode?: string;
    nbsCode?: string;
    description: string;
    pisCofinsCst?: string;
    ibsCbs?: { operationCode: string; cst: string; classCode: string };
    export?: {
      mode: '0' | '1' | '2' | '3' | '4';
      providerLink: '0' | '1' | '2' | '3' | '4' | '5' | '6';
      providerSupport: string;
      customerSupport: string;
      temporaryGoods: '0' | '1' | '2' | '3';
      mdic: '0' | '1';
    };
  };
  customer: InvoiceParty;
  serviceCents: number;
  foreign?: { currencyCode: string; amountCents: number }; // BACEN code, e.g. 220
  simplesPercent: number; // hundredths
  issRate?: number; // hundredths; only written when the ISS is retained
  issRetained?: boolean;
}

export type IssueOutcome =
  // recovered: found by DPS id after E0014, so it may belong to another system.
  | { kind: 'issued'; invoice: ProviderInvoice; recovered?: true }
  | { kind: 'rejected'; errors: { code: string; message: string }[] }
  | { kind: 'uncertain'; reason: string };

export type CancelOutcome =
  | { kind: 'cancelled'; event: ProviderEvent | null }
  | { kind: 'rejected'; error: { code: string; message: string } };

export interface InvoiceIssuer {
  dpsId(series: string, number: number, templateXml: string): string;
  issue(request: IssueRequest): Promise<IssueOutcome>;
  findIssued(dpsId: string): Promise<ProviderInvoice | null>;
  cancel(accessKey: string, reason: '1' | '2' | '9', justification: string): Promise<CancelOutcome>;
}
