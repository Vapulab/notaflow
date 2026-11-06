import { PDFDocument } from 'pdf-lib';
import { embedFonts } from './draw';
import { drawInvoicePage, ROWS_PER_PAGE } from './invoiceTable';
import { drawFooter, drawListHeader, PAGE_HEIGHT, PAGE_WIDTH } from './pageFrame';
import { periodLabel } from './period';
import { summarize } from './summarize';
import { drawSummaryPage } from './summaryPage';
import type { ReportInput } from './types';

export async function renderReport(input: ReportInput): Promise<{ pdf: Uint8Array; pages: number }> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Relatório de NFS-e · ${input.emitter.shortName} · ${periodLabel(input.period)}`);
  doc.setCreator('NotaFlow');
  doc.setProducer('NotaFlow');
  const fonts = await embedFonts(doc);
  const summary = summarize(input.rows, input.period);

  drawSummaryPage(doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]), fonts, input, summary);
  let running = 0;
  for (let start = 0; start < input.rows.length; start += ROWS_PER_PAGE) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawListHeader(page, fonts, input);
    running = drawInvoicePage(page, fonts, input.rows.slice(start, start + ROWS_PER_PAGE), running);
  }

  const pages = doc.getPages();
  pages.forEach((page, i) => drawFooter(page, fonts, input, i + 1, pages.length));
  return { pdf: await doc.save(), pages: pages.length };
}
