import { expect, test } from 'vitest';
import { imageOnlyPdf, syntheticCard } from '../../test/syntheticCard';
import { CardError, parseCardText, readCard } from './cardReader';

test('a card gives its CNPJ, without punctuation, and its legal name', async () => {
  const card = await readCard(await syntheticCard());
  expect(card).toEqual({ cnpj: '12345678000195', legalName: 'EMPRESA TESTE LTDA' });
});

test('the label of a title split over lines is not mistaken for the field', () => {
  const text = [
    'COMPROVANTE DE INSCRIÇÃO E DE',
    'SITUAÇÃO',
    'CADASTRAL',
    'NÚMERO DE INSCRIÇÃO',
    '12.345.678/0001-95',
    'NOME EMPRESARIAL',
    'EMPRESA TESTE LTDA',
  ].join('\n');
  expect(parseCardText(text)).toEqual({ cnpj: '12345678000195', legalName: 'EMPRESA TESTE LTDA' });
});

test('a card without the name label still gives its CNPJ', () => {
  expect(parseCardText('NÚMERO DE INSCRIÇÃO\n12.345.678/0001-95')).toEqual({
    cnpj: '12345678000195',
    legalName: null,
  });
});

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof CardError ? error.code : String(error)),
  );

test('a PDF without text, such as a scan, cannot be read', async () => {
  expect(await errorOf(readCard(await imageOnlyPdf()))).toBe('card_unreadable');
});

test('a file that is not a PDF cannot be read', async () => {
  expect(await errorOf(readCard(Buffer.from('<html>not a pdf</html>')))).toBe('card_unreadable');
});

test('a text without a CNPJ is refused', async () => {
  const card = await syntheticCard({ cnpj: 'sem numero' });
  expect(await errorOf(readCard(card))).toBe('card_no_cnpj');
});

test('a card over 2 MB is refused before parsing', async () => {
  const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2 * 1024 * 1024)]);
  expect(await errorOf(readCard(big))).toBe('card_too_large');
});

test('a parser that does not answer in time is stopped', async () => {
  const card = await syntheticCard();
  expect(await errorOf(readCard(card, { timeoutMs: 1 }))).toBe('card_unreadable');
});
