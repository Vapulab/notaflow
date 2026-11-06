import { issRetained, pisCofinsRetained } from '@notaflow/provider-nacional';
import type { PDFPage, RGB } from 'pdf-lib';
import {
  drawBox, drawLine, drawText, FAINT, formatCents, formatDocument, INK, MUTED, RED, RULE, ZEBRA, type Fonts,
} from './draw';
import { CONTENT_RIGHT, FOOTER_TOP, LIST_HEADER_BOTTOM, MARGIN } from './pageFrame';
import type { ReportRow } from './types';

type Line = { text: string; color?: RGB; bold?: boolean };
type Column = { title: string[]; sub?: string[]; width: number; numeric: boolean; cell: (row: ReportRow) => Line[] };

const SIZE = 6.3;
const LINE = 7.2;
const PAD = 3;
const ROW_HEIGHT = 25;
const HEAD_TOP = LIST_HEADER_BOTTOM + 7;
const HEAD_BOTTOM = HEAD_TOP + 22;
const RUNNING_TOP = FOOTER_TOP - 19;
export const ROWS_PER_PAGE = Math.floor((RUNNING_TOP - 2 - HEAD_BOTTOM) / ROW_HEIGHT);

const DASH: Line = { text: '-', color: MUTED };

function br(isoDate: string | undefined): Line {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return DASH;
  return { text: `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}/${isoDate.slice(0, 4)}` };
}

function value(text: string | undefined, color?: RGB): Line {
  return text ? { text, ...(color ? { color } : {}) } : DASH;
}

function money(cents: number | null | undefined, red = false): Line {
  if (cents === null || cents === undefined) return DASH;
  return { text: formatCents(cents), ...(red ? { color: RED } : {}) };
}

function rate(raw: string | undefined): Line {
  const n = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(n) ? { text: `${n.toFixed(2).replace('.', ',')}%` } : DASH;
}

// A group with no field at all prints one "-" instead of a column of dashes.
function group(lines: Line[]): Line[] {
  return lines.every((l) => l === DASH) ? [DASH] : lines;
}

const COLUMNS: Column[] = [
  {
    title: ['Tipo'], width: 40, numeric: false,
    cell: (r) => [r.status === 'cancelled' ? { text: 'Cancelada', color: RED, bold: true } : { text: 'Emitida', bold: true }],
  },
  { title: ['Nota'], width: 34, numeric: false, cell: (r) => [value(r.fields?.number ?? r.number ?? undefined)] },
  {
    title: ['Datas'], sub: ['dCompet', 'dhEmi'], width: 42, numeric: false,
    cell: (r) => (r.fields ? [br(r.fields.competence), { ...br(r.fields.issuedAt), color: MUTED }] : [DASH]),
  },
  {
    title: ['Tomador'], sub: ['xNome · CNPJ/CPF'], width: 134, numeric: false,
    cell: (r) => [value(r.customerName ?? undefined), { text: formatDocument(r.customerDocument), color: MUTED }],
  },
  {
    title: ['Local / Serviço'], sub: ['xLocIncid · cTribNac · cNBS'], width: 80, numeric: false,
    cell: (r) =>
      r.fields
        ? group([value(r.fields.municipality), value(r.fields.nationalCode, MUTED), value(r.fields.nbsCode, MUTED)])
        : [DASH],
  },
  { title: ['TpRet', 'ISSQN'], width: 30, numeric: true, cell: (r) => [value(r.fields?.issWithholding)] },
  { title: ['Alíq.'], width: 30, numeric: true, cell: (r) => [rate(r.fields?.issRate)] },
  {
    title: ['ISSQN'], width: 46, numeric: true,
    cell: (r) => [money(r.fields?.cents.iss, issRetained(r.fields?.issWithholding))],
  },
  { title: ['TpRet', 'PIS/COF'], width: 32, numeric: true, cell: (r) => [value(r.fields?.pisCofinsWithholding)] },
  {
    title: ['PIS/COFINS'], sub: ['CST · vPis', 'vCofins'], width: 46, numeric: true,
    cell: (r) => {
      const f = r.fields;
      if (!f) return [DASH];
      const retained = pisCofinsRetained(f.pisCofinsWithholding);
      return group([value(f.cst), money(f.cents.pis, retained.pis), money(f.cents.cofins, retained.cofins)]);
    },
  },
  {
    title: ['IBS/CBS'], sub: ['UF · Mun · CBS'], width: 44, numeric: true,
    cell: (r) => (r.fields ? group([money(r.fields.cents.ibsUf), money(r.fields.cents.ibsMun), money(r.fields.cents.cbs)]) : [DASH]),
  },
  { title: ['CP'], width: 46, numeric: true, cell: (r) => [money(r.fields?.cents.retCp, true)] },
  { title: ['IRRF'], width: 42, numeric: true, cell: (r) => [money(r.fields?.cents.retIrrf, true)] },
  { title: ['CSLL'], width: 44, numeric: true, cell: (r) => [money(r.fields?.cents.retCsll, true)] },
  {
    title: ['Desc/Ded/Red'], sub: ['vDescIncond', 'vDescCond · vDR'], width: 52, numeric: true,
    cell: (r) =>
      r.fields
        ? group([money(r.fields.cents.discountUncond), money(r.fields.cents.discountCond), money(r.fields.cents.deduction)])
        : [DASH],
  },
  {
    title: ['Serviço'], sub: ['vServ · vLiq'], width: 60, numeric: true,
    cell: (r) => (r.fields ? [money(r.fields.cents.service), money(r.fields.cents.net, true)] : [DASH]),
  },
];

function columnX(): number[] {
  const xs: number[] = [];
  let x = MARGIN;
  for (const c of COLUMNS) {
    xs.push(x);
    x += c.width;
  }
  return xs;
}
const COLUMN_X = columnX();

function drawHead(page: PDFPage, fonts: Fonts): void {
  COLUMNS.forEach((c, i) => {
    const left = COLUMN_X[i] ?? MARGIN;
    const x = c.numeric ? left + c.width - PAD : left + PAD;
    const align = c.numeric ? 'right' : 'left';
    const width = c.width - 2 * PAD;
    let baseline = HEAD_TOP + 6;
    for (const title of c.title) {
      drawText(page, title.toUpperCase(), x, baseline, { font: fonts.bold, size: 5.8, color: MUTED, align, width });
      baseline += 6.5;
    }
    for (const sub of c.sub ?? []) {
      drawText(page, sub, x, baseline, { font: fonts.regular, size: 5.2, color: FAINT, align, width });
      baseline += 6;
    }
  });
  drawLine(page, MARGIN, CONTENT_RIGHT, HEAD_BOTTOM, INK, 0.75);
}

function drawRow(page: PDFPage, fonts: Fonts, row: ReportRow, top: number, zebra: boolean): void {
  if (zebra) drawBox(page, MARGIN, top, CONTENT_RIGHT - MARGIN, ROW_HEIGHT, { fill: ZEBRA });
  COLUMNS.forEach((c, i) => {
    const left = COLUMN_X[i] ?? MARGIN;
    const x = c.numeric ? left + c.width - PAD : left + PAD;
    let baseline = top + 8.5;
    for (const line of c.cell(row)) {
      drawText(page, line.text, x, baseline, {
        font: line.bold ? fonts.bold : fonts.regular,
        size: SIZE,
        color: line.color ?? INK,
        align: c.numeric ? 'right' : 'left',
        width: c.width - 2 * PAD,
      });
      baseline += LINE;
    }
  });
  drawLine(page, MARGIN, CONTENT_RIGHT, top + ROW_HEIGHT, RULE, 0.5);
}

function issuedService(row: ReportRow): number {
  return row.status === 'issued' ? (row.fields?.cents.service ?? 0) : 0;
}

// Draws one page of rows and returns the running total of vServ after it.
export function drawInvoicePage(page: PDFPage, fonts: Fonts, rows: ReportRow[], runningBefore: number): number {
  drawHead(page, fonts);
  let running = runningBefore;
  rows.forEach((row, i) => {
    drawRow(page, fonts, row, HEAD_BOTTOM + 1 + i * ROW_HEIGHT, i % 2 === 1);
    running += issuedService(row);
  });
  drawLine(page, MARGIN, CONTENT_RIGHT, RUNNING_TOP, INK, 0.75);
  drawText(page, `Acumulado do valor serviço até esta página: ${formatCents(running)}`, CONTENT_RIGHT, RUNNING_TOP + 10, {
    font: fonts.bold, size: 7.5, align: 'right',
  });
  return running;
}
