import { expect, test } from 'vitest';
import { maskPath, maskPersonalData } from './mask';

test.each([
  ['escreva para joao.silva+nf@empresa.com.br hoje', 'escreva para [e-mail] hoje'],
  ['MAIL: Ana_B@sub.exemplo.io.', 'MAIL: [e-mail].'],
  ['CNPJ 12.345.678/0001-95 do tomador', 'CNPJ [CNPJ] do tomador'],
  ['CNPJ 12345678000195 sem pontos', 'CNPJ [CNPJ] sem pontos'],
  ['novo CNPJ 12.ABC.345/01DE-35 alfanumérico', 'novo CNPJ [CNPJ] alfanumérico'],
  ['novo CNPJ 12ABC34501DE35 sem pontos', 'novo CNPJ [CNPJ] sem pontos'],
  ['CPF 123.456.789-09 do cliente', 'CPF [CPF] do cliente'],
  ['CPF 12345678909 sem pontos', 'CPF [número] sem pontos'],
  ['ligue (43) 99999-8888', 'ligue [telefone]'],
  ['ligue +55 43 99999 8888 ou 43 3322-1100', 'ligue [telefone] ou [telefone]'],
  ['ou 99999-8888.', 'ou [telefone].'],
  ['chave 35503082212345678000195000000000000123456789012', 'chave [número]'],
])('masks %s', (text, masked) => {
  expect(maskPersonalData(text)).toBe(masked);
});

test.each([
  'Erro ao emitir a nota 123 de R$ 1.234,56 em 21/10/2026 às 14:30',
  'Competência 2026-10, alíquota 2,5%, série 900',
  'O botão Emitir não responde no Firefox 131',
  'CNPJ inválido na tela de clientes',
])('keeps a text with no personal data: %s', (text) => {
  expect(maskPersonalData(text)).toBe(text);
});

test('masks every match in a long text, and never the words around it', () => {
  const text =
    'Tomador 12.345.678/0001-95, contato ana@ex.com, fone (11) 3333-4444, CPF 111.222.333-44.';
  expect(maskPersonalData(text)).toBe(
    'Tomador [CNPJ], contato [e-mail], fone [telefone], CPF [CPF].',
  );
});

test.each([
  ['/app/0b9e7c1a-4f7e-4d39-9a0c-2b1c3d4e5f60/notas', '/app/:id/notas'],
  [
    '/app/0b9e7c1a-4f7e-4d39-9a0c-2b1c3d4e5f60/notas/7c9e6679-7425-40de-944b-e07fc1f90ae7',
    '/app/:id/notas/:id',
  ],
  ['/app/acc/clientes/12345678000195', '/app/:id/clientes/:id'],
  ['/app/acc/notas/123456', '/app/:id/notas/:id'],
  ['/app/acc/notas/nova?cliente=c1#topo', '/app/:id/notas/nova'],
  ['/app/conta', '/app/conta'],
  ['/app/acc/emitentes/abcdefghijklmnopqrstuvwxyz', '/app/:id/emitentes/:id'],
  ['/app/acc/clientes/joao.silva@empresa.com', '/app/:id/clientes/:id'],
  ['/app/acc/notas/`@octocat`', '/app/:id/notas/:id'],
  ['/app/acc/clientes/Maria%20Souza', '/app/:id/clientes/:id'],
])('the path %s becomes %s', (path, masked) => {
  expect(maskPath(path)).toBe(masked);
});
