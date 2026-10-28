import { expect, test } from 'vitest';
import { readFixture } from '../../test/fixtures';
import { validateAgainstXsd } from '../../test/xsd';
import { buildDpsXml } from '../dps/buildDpsXml';
import { ibsCbsDefaults } from '../rules/ibsCbsDefaults';
import { applyTemplate } from './applyTemplate';
import { readTemplate } from './readTemplate';
import type { DpsTemplate } from './readTemplate';

const template: DpsTemplate = {
  emitterMunicipality: '4113700',
  provider: { cnpj: '12345678000195', simplesNacional: '3', specialRegime: '0' },
  service: { municipality: '4113700', nationalTaxCode: '070201', description: 'Pintura' },
  serviceCents: 100000,
  tax: { issqnTaxation: '1', issRetention: '1', cpRetainedCents: 11000 },
};

const request = {
  source: { kind: 'built' as const, template: '' },
  series: '900',
  number: 1,
  issuedAt: new Date('2026-10-21T12:00:00Z'),
  competence: '2026-10-21',
  environment: 'producao_restrita' as const,
  appVersion: 'notaflow-test',
};

test('a copy with the same amount keeps the retained INSS', () => {
  expect(applyTemplate(template, { ...request, serviceCents: 100000 }).tax.cpRetainedCents).toBe(
    11000,
  );
});

test('a copy with another amount keeps the share of the retained INSS', () => {
  expect(applyTemplate(template, { ...request, serviceCents: 250050 }).tax.cpRetainedCents).toBe(
    27506,
  );
});

const nt004Now = {
  ...request,
  environment: 'producao' as const,
  issuedAt: new Date('2026-11-30T12:00:00Z'),
};

test('a stored NT 004 domestic invoice gets the default group under NT 009, valid against the XSD', () => {
  const stored = readTemplate(readFixture('NFSE_DOMESTIC.xml'));
  expect(stored.ibsCbs).toBeUndefined();
  const input = applyTemplate(stored, { ...request, serviceCents: stored.serviceCents });
  expect(input.ibsCbs).toMatchObject({
    purpose: '0',
    finalConsumer: '0',
    destination: '0',
    cst: '000',
  });
  const { xml } = buildDpsXml(input);
  expect(xml).toContain('<IBSCBS>');
  expect(validateAgainstXsd(xml, 'DPS_v1.01.xsd', 'nt009').errors).toEqual([]);
});

test('the same copy under NT 004 writes no IBSCBS', () => {
  const stored = readTemplate(readFixture('NFSE_DOMESTIC.xml'));
  const { xml } = buildDpsXml(
    applyTemplate(stored, { ...nt004Now, serviceCents: stored.serviceCents }),
  );
  expect(xml).not.toContain('IBSCBS');
});

test('a built template without ibsCbs gets the group under NT 009', () => {
  const input = applyTemplate(template, { ...request, serviceCents: 100000 });
  expect(input.ibsCbs).toMatchObject(ibsCbsDefaults('070201'));
});

test('indFinal follows the customer of the copy', () => {
  const party = (type: 'CPF' | 'CNPJ', value: string) => ({
    document: { type, value },
    name: 'Cliente',
  });
  const withCnpj = { ...template, customer: party('CNPJ', '11222333000181') };
  const cpf = party('CPF', '11144477735');
  expect(
    applyTemplate(withCnpj, { ...request, serviceCents: 1, customer: cpf }).ibsCbs?.finalConsumer,
  ).toBe('1');
  const withCpf = {
    ...template,
    customer: cpf,
    ibsCbs: {
      purpose: '0',
      finalConsumer: '1' as const,
      destination: '0',
      cst: '000',
      classCode: '000001',
      operationCode: '100301',
    },
  };
  expect(
    applyTemplate(withCpf, {
      ...request,
      serviceCents: 1,
      customer: party('CNPJ', '11222333000181'),
    }).ibsCbs?.finalConsumer,
  ).toBe('0');
});

test('an NT 009 domestic template is issued again unchanged', () => {
  const group = {
    purpose: '0',
    finalConsumer: '0' as const,
    destination: '0',
    cst: '000',
    classCode: '000001',
    operationCode: '100301',
  };
  expect(
    applyTemplate({ ...template, ibsCbs: group }, { ...request, serviceCents: 100000 }).ibsCbs,
  ).toEqual(group);
});
