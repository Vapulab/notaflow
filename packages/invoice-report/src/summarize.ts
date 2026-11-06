import { issRetained, pisCofinsRetained } from '@notaflow/provider-nacional';
import { spansMonths, type ReportPeriod } from './period';
import type { MonthLine, ReportRow, ReportSummary, ReportTotals } from './types';

const ABBREVIATIONS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function emptyTotals(): ReportTotals {
  return {
    service: 0, totalRet: 0, discounts: 0, net: 0,
    retCp: 0, retIrrf: 0, retCsll: 0, issRetained: 0,
    issNotRetained: 0, ownPisCofins: 0, ibsUf: 0, ibsMun: 0, cbs: 0, ibsCbs: 0,
  };
}

function monthLabel(month: string): string {
  return `${ABBREVIATIONS[Number(month.slice(5, 7)) - 1] ?? ''}/${month.slice(0, 4)}`;
}

function monthsBetween(period: ReportPeriod): MonthLine[] {
  const lines: MonthLine[] = [];
  let year = Number(period.from.slice(0, 4));
  let month = Number(period.from.slice(5, 7));
  const last = period.to.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    lines.push({ month: key, label: monthLabel(key), count: 0, service: 0, totalRet: 0, net: 0 });
    if (key >= last) return lines;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}

export function summarize(rows: ReportRow[], period: ReportPeriod): ReportSummary {
  const totals = emptyTotals();
  const months = spansMonths(period) ? monthsBetween(period) : [];
  let issuedCount = 0;
  let cancelledCount = 0;
  let missingXmlCount = 0;

  for (const row of rows) {
    if (row.status === 'cancelled') {
      cancelledCount += 1;
      continue;
    }
    issuedCount += 1;
    if (!row.fields) {
      missingXmlCount += 1;
      continue;
    }
    const f = row.fields;
    const c = f.cents;
    totals.service += c.service ?? 0;
    totals.totalRet += c.totalRet ?? 0;
    totals.discounts += (c.discountUncond ?? 0) + (c.discountCond ?? 0);
    totals.net += c.net ?? 0;
    totals.retCp += c.retCp ?? 0;
    totals.retIrrf += c.retIrrf ?? 0;
    totals.retCsll += c.retCsll ?? 0;
    if (issRetained(f.issWithholding)) totals.issRetained += c.iss ?? 0;
    else totals.issNotRetained += c.iss ?? 0;
    const retained = pisCofinsRetained(f.pisCofinsWithholding);
    if (!retained.pis) totals.ownPisCofins += c.pis ?? 0;
    if (!retained.cofins) totals.ownPisCofins += c.cofins ?? 0;
    totals.ibsUf += c.ibsUf ?? 0;
    totals.ibsMun += c.ibsMun ?? 0;
    totals.cbs += c.cbs ?? 0;

    const line = months.find((m) => m.month === f.competence?.slice(0, 7));
    if (line) {
      line.count += 1;
      line.service += c.service ?? 0;
      line.totalRet += c.totalRet ?? 0;
      line.net += c.net ?? 0;
    }
  }
  totals.ibsCbs = totals.ibsUf + totals.ibsMun + totals.cbs;
  return { issuedCount, cancelledCount, missingXmlCount, totals, months };
}
