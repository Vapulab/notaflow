import { PDFDocument, StandardFonts } from 'pdf-lib';

// A text PDF laid out like the Receita card: each label on its own line, its value on the next.
export async function syntheticCard(
  fields: { cnpj?: string; legalName?: string; status?: string } = {},
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = [
    'REPUBLICA FEDERATIVA DO BRASIL',
    'CADASTRO NACIONAL DA PESSOA JURIDICA',
    'NÚMERO DE INSCRIÇÃO',
    fields.cnpj ?? '12.345.678/0001-95',
    'MATRIZ',
    'COMPROVANTE DE INSCRIÇÃO E DE',
    'SITUAÇÃO',
    'CADASTRAL',
    'NOME EMPRESARIAL',
    fields.legalName ?? 'EMPRESA TESTE LTDA',
    'TÍTULO DO ESTABELECIMENTO (NOME DE FANTASIA)',
    'TESTE',
    'MUNICÍPIO',
    'LONDRINA',
    'UF',
    'PR',
    'SITUAÇÃO CADASTRAL',
    fields.status ?? 'ATIVA',
  ];
  lines.forEach((line, i) => page.drawText(line, { x: 40, y: 800 - i * 20, size: 10, font }));
  return Buffer.from(await doc.save());
}

// A PDF with a page and no text at all, like a scanned card.
export async function imageOnlyPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]).drawRectangle({ x: 40, y: 40, width: 100, height: 100 });
  return Buffer.from(await doc.save());
}
