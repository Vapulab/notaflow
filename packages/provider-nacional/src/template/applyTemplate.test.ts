import { expect, test } from 'vitest';
import { applyTemplate } from './applyTemplate';
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
