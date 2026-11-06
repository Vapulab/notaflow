import type { ReportFields } from '@notaflow/provider-nacional';
import type { ReportPeriod } from './period';

export type ReportRow = {
  status: 'issued' | 'cancelled';
  number: string | null;
  customerName: string | null;
  customerDocument: string | null;
  fields: ReportFields | null; // null = no XML, or the XML did not parse
};

export type ReportInput = {
  emitter: { legalName: string; cnpj: string; shortName: string };
  period: ReportPeriod;
  generatedAt: Date;
  rows: ReportRow[];
};

export type ReportTotals = {
  service: number;
  totalRet: number;
  discounts: number;
  net: number;
  retCp: number;
  retIrrf: number;
  retCsll: number;
  issRetained: number;
  issNotRetained: number;
  ownPisCofins: number;
  ibsUf: number;
  ibsMun: number;
  cbs: number;
  ibsCbs: number;
};

export type MonthLine = {
  month: string; // YYYY-MM
  label: string; // Out/2026
  count: number;
  service: number;
  totalRet: number;
  net: number;
};

export type ReportSummary = {
  issuedCount: number;
  cancelledCount: number;
  missingXmlCount: number;
  totals: ReportTotals;
  months: MonthLine[]; // empty unless the period spans months
};
