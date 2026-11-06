import { PDFDocument } from 'pdf-lib';
import { extractText } from 'unpdf';

export interface PdfFacts {
  pages: number;
  width: number;
  height: number;
  text: string;
  producer: string | undefined;
}

export async function pdfFacts(pdf: Uint8Array): Promise<PdfFacts> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const size = doc.getPage(0).getSize();
  const { text } = await extractText(new Uint8Array(pdf), { mergePages: true });
  return { pages: doc.getPageCount(), width: size.width, height: size.height, text, producer: doc.getProducer() };
}
