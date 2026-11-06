import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { monthPeriod, yearPeriod, type ReportPeriod } from '../src/period';
import { renderReport } from '../src/renderReport';
import type { ReportRow } from '../src/types';

const CUSTOMERS = [
  ['CLIENTE EXEMPLO UM LTDA', '98765432000198'],
  ['CLIENTE EXEMPLO DOIS LTDA', '11122233000183'],
  ['CLIENTE EXEMPLO TRES LTDA', '44455566000183'],
  ['MARIA DA SILVA', '12345678909'],
] as const;
const PLACES = ['Londrina', 'Jacarezinho', 'São José do Rio Preto', 'Francisco Beltrão'];

function synthetic(count: number, month: (i: number) => string): ReportRow[] {
  return Array.from({ length: count }, (_, i) => {
    const [name, document] = CUSTOMERS[i % CUSTOMERS.length] ?? CUSTOMERS[0];
    const service = 150000 + ((i * 7919) % 4000000);
    const pct = (n: number): number => Math.round((service * n) / 10000);
    const retained = i % 3 !== 0;
    const iss = pct(500);
    const totalRet = pct(1100) + pct(100) + pct(465) + (retained ? iss : 0);
    const competence = `${month(i)}-${String((i % 28) + 1).padStart(2, '0')}`;
    return {
      status: i % 40 === 39 ? 'cancelled' : 'issued',
      number: String(5657 + i),
      customerName: name,
      customerDocument: document,
      fields:
        i === 5
          ? null
          : {
              number: String(5657 + i),
              competence,
              issuedAt: `${competence}T10:00:00-03:00`,
              municipality: PLACES[i % PLACES.length],
              nationalCode: '071001',
              nbsCode: '118031000',
              issWithholding: retained ? '2' : '1',
              issRate: '5.00',
              pisCofinsWithholding: '1',
              cst: '01',
              cents: {
                service, net: service - totalRet, iss, pis: null, cofins: null, ibsUf: pct(10), ibsMun: 0, cbs: pct(90),
                retCp: pct(1100), retIrrf: pct(100), retCsll: pct(465), totalRet,
                discountUncond: i % 50 === 0 ? 1 : null, discountCond: null, deduction: null,
              },
            },
    };
  });
}

function input(period: ReportPeriod, rows: ReportRow[]) {
  return {
    emitter: { legalName: 'EMPRESA EXEMPLO SERVICOS LTDA', cnpj: '12345678000195', shortName: 'Empresa Exemplo' },
    period,
    generatedAt: new Date(),
    rows,
  };
}

const out = fileURLToPath(new URL('../sample/', import.meta.url));
mkdirSync(out, { recursive: true });
const october = monthPeriod('2026-10');
const cases: [string, ReportPeriod, ReportRow[]][] = [
  ...[0, 30, 600].map((n): [string, ReportPeriod, ReportRow[]] => [`sample-${n}`, october, synthetic(n, () => '2026-10')]),
  ['sample-year', yearPeriod(2026), synthetic(600, (i) => `2026-${String((i % 12) + 1).padStart(2, '0')}`)],
];
for (const [name, period, rows] of cases) {
  const { pdf, pages } = await renderReport(input(period, rows));
  writeFileSync(`${out}${name}.pdf`, pdf);
  console.log(`${out}${name}.pdf (${pages} pages)`);
}

const big = synthetic(6000, () => '2026-10');
const started = performance.now();
const { pages } = await renderReport(input(october, big));
console.log(`6000 rows: ${pages} pages in ${((performance.now() - started) / 1000).toFixed(2)} s`);
