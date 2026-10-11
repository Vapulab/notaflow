// Reads a real CNPJ card locally and prints only which labels it found, never a value.
// Usage: pnpm tsx apps/server/scripts/cardLabels.ts <path-to-card.pdf>
import { readFileSync } from 'node:fs';
import { extractText, getDocumentProxy } from 'unpdf';

const LABELS = [
  'NÚMERO DE INSCRIÇÃO',
  'COMPROVANTE DE INSCRIÇÃO E DE SITUAÇÃO CADASTRAL',
  'NOME EMPRESARIAL',
  'TÍTULO DO ESTABELECIMENTO (NOME DE FANTASIA)',
  'CÓDIGO E DESCRIÇÃO DA ATIVIDADE ECONÔMICA PRINCIPAL',
  'MUNICÍPIO',
  'UF',
  'SITUAÇÃO CADASTRAL',
  'DATA DA SITUAÇÃO CADASTRAL',
];

const path = process.argv[2];
if (!path) {
  console.error('Usage: cardLabels.ts <card.pdf>');
  process.exit(1);
}
const pdf = await getDocumentProxy(new Uint8Array(readFileSync(path)));
const { totalPages, text } = await extractText(pdf, { mergePages: true });
const upper = text.toUpperCase();
console.log(`pages: ${totalPages}, characters: ${text.length}`);
for (const label of LABELS)
  console.log(`${upper.includes(label) ? 'found  ' : 'missing'} ${label}`);
const cnpj = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/.exec(text);
console.log(`CNPJ pattern: ${cnpj ? 'matched' : 'not found'}`);
// The line order of the labels, so the parser knows which value follows which label.
const order = LABELS.filter((l) => upper.includes(l)).sort(
  (a, b) => upper.indexOf(a) - upper.indexOf(b),
);
console.log(`order: ${order.join(' > ')}`);

// The parser of the onboarding step, on the same card: whether it found each field, never the value.
const { readCard } = await import('../src/onboarding/cardReader');
const card = await readCard(readFileSync(path));
console.log(
  `parser: CNPJ ${card.cnpj.length === 14 ? 'ok' : 'wrong'}, legal name ${card.legalName ? 'found' : 'missing'}`,
);
