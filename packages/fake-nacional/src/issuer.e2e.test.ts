import { readFileSync } from 'node:fs';
import { gzipBase64, NacionalClient, NacionalIssuer } from '@notaflow/provider-nacional';
import { loadCertificate } from '@notaflow/signer-node';
import { makeTestCertificate } from '@notaflow/test-kit';
import { Agent } from 'undici';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { type FakeNacional, startFakeNacional } from './index';

const cert = makeTestCertificate();
const certificate = loadCertificate(cert.pfx, cert.password);
let fake: FakeNacional;
let issuer: NacionalIssuer;
let templateXml: string;

beforeEach(async () => {
  fake = await startFakeNacional();
  const client = new NacionalClient({
    environment: 'producao_restrita',
    dispatcher: new Agent(),
    urls: fake.urls,
    timeoutMs: 300,
  });
  issuer = new NacionalIssuer({
    client,
    certificate,
    environment: 'producao_restrita',
    appVersion: 'notaflow-test',
  });
  templateXml = readFileSync(
    new URL('../../provider-nacional/test/fixtures/NFSE_EXPORT_FULL.xml', import.meta.url),
    'utf8',
  );
});
afterEach(() => fake.close());

const request = (number: number) => ({
  source: { kind: 'stored' as const, xml: templateXml },
  series: '900',
  number,
  issuedAt: new Date(Date.now() - 60_000),
  competence: '2026-10-01',
  serviceCents: 670321,
  foreignAmountCents: 123400,
  description: 'Serviços de outubro',
});

test('issues a copy of the template with the new amounts and description', async () => {
  const outcome = await issuer.issue(request(1));
  expect(outcome.kind).toBe('issued');
  if (outcome.kind !== 'issued') return;
  expect(outcome.invoice).toMatchObject({
    competence: '2026-10-01',
    amounts: { serviceCents: 670321 },
    service: { nationalTaxCode: '010701', description: 'Serviços de outubro' },
    customer: { document: { type: 'NIF', value: '00-0000000' } },
  });
  expect(outcome.invoice.xml).toContain('<vServMoeda>1234.00</vServMoeda>');
  expect(outcome.invoice.xml).toContain('<cClassTrib>410027</cClassTrib>');
  // The template declares 02 (ACC, public administration); a copy declares none (01).
  expect(outcome.invoice.xml).toContain('<mecAFComexP>01</mecAFComexP>');
  expect(outcome.invoice.xml).toContain('<mecAFComexT>01</mecAFComexT>');
});

test('a resend of an issued DPS (E0014) ends issued through the lookup', async () => {
  await issuer.issue(request(2));
  const again = await issuer.issue(request(2));
  expect(again.kind).toBe('issued');
});

test('a timeout is uncertain, and findIssued then finds the invoice', async () => {
  fake.next('issue', { kind: 'delay', ms: 600 });
  expect((await issuer.issue(request(3))).kind).toBe('uncertain');
  const stored = { kind: 'stored' as const, xml: templateXml };
  const dpsId = issuer.dpsId('900', 3, stored);
  expect((await issuer.findIssued(dpsId))?.dps.number).toBe(3);
  expect(await issuer.findIssued(issuer.dpsId('900', 99, stored))).toBeNull();
});

test('an export template without a foreign amount is rejected locally, before sending', async () => {
  const { foreignAmountCents: _ignored, ...withoutForeign } = request(4);
  const outcome = await issuer.issue(withoutForeign);
  expect(outcome).toMatchObject({ kind: 'rejected', errors: [{ code: 'local_error' }] });
  expect(fake.issuedCount()).toBe(0);
});

test('cancel registers the event and returns it parsed', async () => {
  const issued = await issuer.issue(request(5));
  if (issued.kind !== 'issued') throw new Error('not issued');
  const cancelled = await issuer.cancel(
    issued.invoice.accessKey,
    '1',
    'Valor do serviço incorreto',
  );
  expect(cancelled).toMatchObject({
    kind: 'cancelled',
    event: { code: '101101', reasonCode: '1' },
  });
  expect(
    await issuer.cancel(issued.invoice.accessKey, '1', 'Valor do serviço incorreto'),
  ).toMatchObject({
    kind: 'rejected',
  });
});

test('a registered cancel whose event XML does not parse is still cancelled', async () => {
  const issued = await issuer.issue(request(6));
  if (issued.kind !== 'issued') throw new Error('not issued');
  fake.next('event', {
    kind: 'reply',
    status: 201,
    body: { eventoXmlGZipB64: gzipBase64('<evento>unexpected</evento>') },
  });
  expect(await issuer.cancel(issued.invoice.accessKey, '1', 'Valor do serviço incorreto')).toEqual({
    kind: 'cancelled',
    event: null,
  });
});

test('issues a Brazil invoice built without a stored template and finds it by DPS id', async () => {
  const template = issuer.buildTemplate({
    competence: '2026-10-01',
    emitter: {
      cnpj: certificate.cnpj,
      municipality: '4113700',
      simplesNacional: '3',
      simplesRegime: '1',
      specialRegime: '0',
    },
    service: { nationalTaxCode: '010701', description: 'Desenvolvimento de software' },
    customer: {
      document: { type: 'CNPJ', value: '11222333000181' },
      name: 'Cliente Teste Ltda',
      address: {
        kind: 'domestic',
        municipality: '4113700',
        zip: '86010000',
        street: 'Rua Teste',
        number: '1',
        district: 'Centro',
      },
    },
    serviceCents: 123400,
    simplesPercent: 600,
  });
  const source = { kind: 'built' as const, template };
  const outcome = await issuer.issue({
    source,
    series: '900',
    number: 7,
    issuedAt: new Date(Date.now() - 60_000),
    competence: '2026-10-01',
    serviceCents: 123400,
  });
  expect(outcome.kind).toBe('issued');
  if (outcome.kind !== 'issued') return;
  expect(outcome.invoice).toMatchObject({
    amounts: { serviceCents: 123400 },
    customer: { document: { type: 'CNPJ', value: '11222333000181' } },
  });
  expect(outcome.invoice.xml).toContain('<pTotTribSN>6.00</pTotTribSN>');
  expect((await issuer.findIssued(issuer.dpsId('900', 7, source)))?.accessKey).toBe(
    outcome.invoice.accessKey,
  );
});

test('a built template of an unknown version is refused, never sent', async () => {
  const template = JSON.stringify({ version: 2, template: {} });
  expect(() => issuer.dpsId('900', 8, { kind: 'built', template })).toThrow(/version/);
  await expect(
    issuer.issue({
      source: { kind: 'built', template },
      series: '900',
      number: 8,
      issuedAt: new Date(Date.now() - 60_000),
      competence: '2026-10-01',
      serviceCents: 100,
    }),
  ).resolves.toMatchObject({ kind: 'rejected', errors: [{ code: 'local_error' }] });
});
