import { expect, test } from 'vitest';
import { ANNEX_QUESTIONS, annexFromAnswers } from './annexQuestions';

const NO = Object.fromEntries(ANNEX_QUESTIONS.map((question) => [question.id, false]));

test('every question has its text, help, and law', () => {
  expect(ANNEX_QUESTIONS.length).toBeGreaterThanOrEqual(5);
  for (const question of ANNEX_QUESTIONS) {
    expect(question.text).toMatch(/\?$/);
    expect(question.help.length).toBeGreaterThan(10);
    expect(question.law).toMatch(/^(LC 123, art\. 18|IN RFB 2\.110\/2022, arts?\.)/);
  }
});

test('labor assignment in a §5º-C activity is Anexo IV', () => {
  const result = annexFromAnswers({ ...NO, labor: true, annex_iv: true });
  expect(result).toEqual({ result: 'IV', law: expect.stringContaining('§5º-C') });
});

test('a §5º-C activity without labor assignment is Anexo IV too', () => {
  expect(annexFromAnswers({ ...NO, annex_iv: true })).toMatchObject({ result: 'IV' });
});

test('an intellectual activity of §5º-I uses the Fator R', () => {
  const result = annexFromAnswers({ ...NO, intellectual: true });
  expect(result).toEqual({ result: 'fator_r', law: expect.stringContaining('§5º-I') });
});

test('a §5º-B or §5º-D activity with the Fator R uses it', () => {
  const result = annexFromAnswers({ ...NO, fator_r_listed: true });
  expect(result).toEqual({ result: 'fator_r', law: expect.stringContaining('§5º-M') });
});

test('a named Anexo III activity wins over the intellectual catch-all (§5º-I XII)', () => {
  const result = annexFromAnswers({ ...NO, annex_iii_listed: true, intellectual: true });
  expect(result).toEqual({ result: 'III', law: expect.stringContaining('§5º-B') });
});

test('a service that no paragraph names and that is not intellectual is Anexo III', () => {
  expect(annexFromAnswers(NO)).toEqual({
    result: 'III',
    law: 'LC 123, art. 18 §5º-F e Anexo III',
    note: expect.stringContaining('responda Sim na última pergunta'),
  });
});

test('communication and cargo transport (§5º-E) are out of scope', () => {
  const result = annexFromAnswers({ ...NO, icms_service: true });
  expect(result).toEqual({
    result: 'out_of_scope',
    reason: 'icms_service',
    law: expect.stringContaining('§5º-E'),
  });
});

test('labor assignment outside §5º-C excludes the company from the Simples', () => {
  expect(annexFromAnswers({ ...NO, labor: true })).toEqual({
    result: 'out_of_scope',
    reason: 'labor',
    law: 'IN RFB 2.110/2022, art. 167, parágrafo único',
  });
});

test.each([
  ['two annexes at once', { ...NO, annex_iv: true, annex_iii_listed: true }],
  ['Anexo IV and the Fator R', { ...NO, annex_iv: true, fator_r_listed: true }],
  ['§5º-E with another annex', { ...NO, icms_service: true, annex_iv: true }],
  ['a missing answer', { ...NO, intellectual: undefined }],
  ['no answers', {}],
])('%s is undecided', (_, answers) => {
  expect(annexFromAnswers(answers)).toEqual({ result: 'undecided' });
});
