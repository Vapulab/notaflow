import type { ReportFields } from '@notaflow/provider-nacional';
import { describe, expect, it } from 'vitest';
import { formatCents, formatMoney } from './draw';
import { pdfFacts } from './pdfText.test-util';
import { monthPeriod, yearPeriod, type ReportPeriod } from './period';
import { renderReport } from './renderReport';
import { summarize } from './summarize';
import type { ReportInput, ReportRow } from './types';

function fields(i: number, competence: string): ReportFields {
  const service = 431065 + i * 100;
  return {
    number: String(5657 + i),
    competence,
    issuedAt: `${competence}T10:00:00-03:00`,
    municipality: 'Londrina',
    nationalCode: '071001',
    nbsCode: '118031000',
    issWithholding: '2',
    issRate: '5.00',
    pisCofinsWithholding: '1',
    cst: '01',
    cents: {
      service, net: service - 93326, iss: 21553, pis: 410, cofins: 3686, ibsUf: 410, ibsMun: 0, cbs: 3686,
      retCp: 47417, retIrrf: 4311, retCsll: 20045, totalRet: 93326, discountUncond: null, discountCond: null,
      deduction: null,
    },
  };
}

function rows(count: number, competence = '2026-10-05'): ReportRow[] {
  return Array.from({ length: count }, (_, i) => ({
    status: 'issued',
    number: String(5657 + i),
    customerName: 'CLIENTE EXEMPLO UM LTDA',
    customerDocument: '98765432000198',
    fields: fields(i, competence),
  }));
}

function input(period: ReportPeriod, list: ReportRow[]): ReportInput {
  return {
    emitter: { legalName: 'EMPRESA EXEMPLO SERVICOS LTDA', cnpj: '12345678000195', shortName: 'Empresa Exemplo' },
    period,
    generatedAt: new Date('2026-11-06T14:24:00Z'),
    rows: list,
  };
}

const october = monthPeriod('2026-10');

describe('renderReport', () => {
  it('formats amounts', () => {
    expect(formatCents(341658236)).toBe('3.416.582,36');
    expect(formatCents(1)).toBe('0,01');
    expect(formatMoney(12975450)).toBe('R$ 129.754,50');
  });

  it('draws page 1 with the period and totals', async () => {
    const list = rows(30);
    const { pdf } = await renderReport(input(october, list));
    const facts = await pdfFacts(pdf);
    expect(facts.text).toContain('Relatório de NFS-e emitidas');
    expect(facts.text).toContain('Outubro de 2026');
    expect(facts.text).toContain('Competência de 01/10/2026 a 31/10/2026');
    expect(facts.text).toContain('Gerado em 06/11/2026 às 11:24');
    expect(facts.text).toContain(formatMoney(summarize(list, october).totals.service));
    expect(facts.text).toContain('R$ 129.754,50');
    expect(facts.text).toContain('Gerado por NotaFlow · notaflow.vapulab.com · Relatório sem valor fiscal');
    expect(Math.round(facts.width)).toBe(842);
    expect(Math.round(facts.height)).toBe(595);
  });

  it('numbers every page', async () => {
    const { pdf, pages } = await renderReport(input(october, rows(600)));
    const facts = await pdfFacts(pdf);
    expect(pages).toBe(facts.pages);
    expect(pages).toBeGreaterThan(2);
    expect(facts.text).toContain(`Página 1 de ${pages}`);
    expect(facts.text).toContain(`Página ${pages} de ${pages}`);
  });

  it('carries the running service total to the last page', async () => {
    const list = rows(600).map((r, i): ReportRow => (i % 7 === 0 ? { ...r, status: 'cancelled' } : r));
    const { pdf } = await renderReport(input(october, list));
    const { text } = await pdfFacts(pdf);
    const label = 'Acumulado do valor serviço até esta página:';
    const lastPage = text.slice(text.lastIndexOf(label));
    expect(lastPage).toContain(`${label} ${formatCents(summarize(list, october).totals.service)}`);
  });

  it('prints an empty period', async () => {
    const { pdf, pages } = await renderReport(input(october, []));
    const facts = await pdfFacts(pdf);
    expect(facts.text).toContain('Nenhuma nota no período');
    expect(pages).toBe(1);
  });

  it('adds the month table for a year', async () => {
    const list = [...rows(2, '2026-03-10'), ...rows(3, '2026-10-05')];
    const { pdf } = await renderReport(input(yearPeriod(2026), list));
    const { text } = await pdfFacts(pdf);
    expect(text).toContain('Mar/2026');
    expect(text).toContain('Out/2026');
  });

  it('marks cancelled rows', async () => {
    const issued = rows(2);
    const cancelled = rows(1).map((r): ReportRow => ({ ...r, status: 'cancelled' }));
    const { pdf } = await renderReport(input(october, [...issued, ...cancelled]));
    const { text } = await pdfFacts(pdf);
    expect(text).toContain('Cancelada');
    expect(text).toContain(formatMoney(431065 + 431165));
    expect(text).not.toContain(formatMoney(431065 * 2 + 431165));
  });

  it('notes rows with no XML', async () => {
    const noXml = (n: number): ReportRow[] => rows(n).map((r) => ({ ...r, fields: null }));
    const one = await pdfFacts((await renderReport(input(october, [...rows(1), ...noXml(1)]))).pdf);
    expect(one.text).toContain('1 nota sem XML ficou fora dos totais');
    const two = await pdfFacts((await renderReport(input(october, [...rows(1), ...noXml(2)]))).pdf);
    expect(two.text).toContain('2 notas sem XML ficaram fora dos totais');
  });
});
