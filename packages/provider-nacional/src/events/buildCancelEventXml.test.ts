import { expect, test } from 'vitest';
import { validateAgainstXsd } from '../../test/xsd';
import { buildCancelEventXml, type CancelEventInput } from './buildCancelEventXml';

const accessKey = '35503082212345678000195000000000000126100000000001';

const base: CancelEventInput = {
  environment: 'producao_restrita',
  requestedAt: new Date('2026-10-08T18:00:00Z'),
  appVersion: 'notaflow-0.0.0',
  authorCnpj: '12345678000195',
  accessKey,
  reason: '1',
  justification: 'Valor informado com erro na emissão',
};

test('builds a pedRegEvento that validates against the XSD', () => {
  expect(
    validateAgainstXsd(buildCancelEventXml(base).xml, 'pedRegEvento_v1.01.xsd', 'nt004').errors,
  ).toEqual([]);
});

test('uses the PRE + key + 101101 id', () => {
  const { id, xml } = buildCancelEventXml(base);
  expect(id).toBe(`PRE${accessKey}101101`);
  expect(id).toHaveLength(59);
  expect(xml).toContain('<xDesc>Cancelamento de NFS-e</xDesc>');
});

test('accepts an access key with an alphanumeric CNPJ', () => {
  const key = `35503081` + `2AB345678000195` + '0'.repeat(27);
  expect(
    validateAgainstXsd(
      buildCancelEventXml({ ...base, accessKey: key }).xml,
      'pedRegEvento_v1.01.xsd',
      'nt004',
    ).errors,
  ).toEqual([]);
});

test.each([
  ['a short justification', { justification: 'curto demais' }],
  ['a long justification', { justification: 'x'.repeat(256) }],
  ['a bad access key', { accessKey: '123' }],
  [
    'an access key with letters outside the CNPJ',
    { accessKey: `355030AB345678000195${'0'.repeat(30)}` },
  ],
])('rejects %s', (_label, override) => {
  expect(() => buildCancelEventXml({ ...base, ...override })).toThrow(RangeError);
});
