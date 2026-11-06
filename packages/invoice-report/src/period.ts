export type PeriodType = 'month' | 'year' | 'range';
export type ReportPeriod = { type: PeriodType; from: string; to: string };

export class PeriodError extends Error {
  constructor(readonly code: 'period_invalid' | 'period_too_long') {
    super(code);
    this.name = 'PeriodError';
  }
}

const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const DAY_MS = 86_400_000;
const MAX_DAYS = 366;

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIso(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new PeriodError('period_invalid');
  const date = new Date(`${value}T00:00:00Z`);
  // Rejects overflow dates such as 2026-02-30.
  if (Number.isNaN(date.getTime()) || iso(date) !== value) throw new PeriodError('period_invalid');
  return date;
}

export function monthPeriod(month: string): ReportPeriod {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const year = Number(match?.[1]);
  const m = Number(match?.[2]);
  if (!match || m < 1 || m > 12) throw new PeriodError('period_invalid');
  return { type: 'month', from: `${month}-01`, to: iso(new Date(Date.UTC(year, m, 0))) };
}

export function yearPeriod(year: number): ReportPeriod {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new PeriodError('period_invalid');
  return { type: 'year', from: `${year}-01-01`, to: `${year}-12-31` };
}

export function rangePeriod(from: string, to: string): ReportPeriod {
  const start = parseIso(from);
  const end = parseIso(to);
  if (start > end) throw new PeriodError('period_invalid');
  if ((end.getTime() - start.getTime()) / DAY_MS + 1 > MAX_DAYS) throw new PeriodError('period_too_long');
  return { type: 'range', from, to };
}

function br(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

export function periodLabel(p: ReportPeriod): string {
  if (p.type === 'year') return p.from.slice(0, 4);
  if (p.type === 'month') {
    const name = MONTHS[Number(p.from.slice(5, 7)) - 1] ?? '';
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${p.from.slice(0, 4)}`;
  }
  return `${br(p.from)} a ${br(p.to)}`;
}

export function periodSlug(p: ReportPeriod): string {
  if (p.type === 'year') return p.from.slice(0, 4);
  if (p.type === 'month') return p.from.slice(0, 7);
  return `${p.from}_${p.to}`;
}

export function spansMonths(p: ReportPeriod): boolean {
  return p.from.slice(0, 7) !== p.to.slice(0, 7);
}
