import { MockAgent } from 'undici';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { issueExportOnFake } from '../../test/fakeInvoices';
import { seedTenant } from '../../test/fixtures';
import { withTemplate } from '../../test/issueSetup';
import { providerInvoice } from '../../test/providerData';
import { createTestApp, type TestApp } from '../../test/testApp';
import { EmitterRepository } from '../repos/EmitterRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

test('the draft copies the template and marks it as an export', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const draft = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}/draft`,
    headers,
  });
  expect(draft.json()).toMatchObject({
    templateInvoiceId,
    serviceCents: 1086420,
    foreign: { currency: 'USD', amountCents: 200000 },
    customer: { document: { type: 'NIF' } },
  });
});

test('issue similar: pending, then issued with a new DPS number and the new amounts', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers,
    payload: {
      templateInvoiceId,
      competence: '2026-09-30',
      serviceCents: 617000,
      foreignAmountCents: 123400,
      description: 'Serviços de setembro',
    },
  });
  expect(response.statusCode).toBe(201);
  expect(response.json()).toMatchObject({ status: 'issued', accessKey: expect.any(String) });
  const { id } = response.json<{ id: string }>();
  const detail = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices/${id}`,
    headers,
  });
  expect(detail.json()).toMatchObject({
    status: 'issued',
    serviceCents: 617000,
    description: 'Serviços de setembro',
    origin: 'app',
  });
});

test('two issues at the same time get two different DPS numbers', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const payload = {
    templateInvoiceId,
    competence: '2026-09-30',
    serviceCents: 100,
    foreignAmountCents: 20,
  };
  const url = `/api/accounts/${a.accountId}/invoices/issue`;
  const [one, two] = await Promise.all([
    t.app.inject({ method: 'POST', url, headers, payload }),
    t.app.inject({ method: 'POST', url, headers, payload }),
  ]);
  expect([one.json().status, two.json().status]).toEqual(['issued', 'issued']);
  expect(one.json().accessKey).not.toBe(two.json().accessKey);
});

test('a zero amount and a future competence are refused before anything is reserved', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const url = `/api/accounts/${a.accountId}/invoices/issue`;
  const zero = await t.app.inject({
    method: 'POST',
    url,
    headers,
    payload: {
      templateInvoiceId,
      competence: '2026-09-30',
      serviceCents: 0,
      foreignAmountCents: 1,
    },
  });
  expect(zero.json()).toEqual({ error: 'invalid_amount' });
  const future = await t.app.inject({
    method: 'POST',
    url,
    headers,
    payload: {
      templateInvoiceId,
      competence: '2999-01-31',
      serviceCents: 1,
      foreignAmountCents: 1,
    },
  });
  expect(future.json()).toEqual({ error: 'competence_after_issue' });
  const list = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices`,
    headers,
  });
  expect(list.json()).toMatchObject({ total: 1 });
});

test('a template with a field the app cannot copy is 422 with the paths, and nothing is reserved', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const headers = await t.as('owner@example.com');
  const emitter = new EmitterRepository(t.db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '4113700',
    simplesNacional: '3',
    specialRegime: '0',
    dpsSeries: '900',
  });
  const xml =
    '<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe><DPS><infDPS><BM><tpBM>1</tpBM></BM></infDPS></DPS></infNFSe></NFSe>';
  const { id } = new InvoiceRepository(t.db).upsertSynced(
    a,
    emitter.id,
    providerInvoice({ xml }),
    null,
  );
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers,
    payload: { templateInvoiceId: id, competence: '2026-09-30', serviceCents: 100 },
  });
  expect(response.statusCode).toBe(422);
  expect(response.json()).toEqual({ error: 'template_unsupported', paths: ['BM/tpBM'] });
  expect(new EmitterRepository(t.db).get(a, emitter.id)?.nextDpsNumber).toBe(1);
});

test('a DPS number used outside the app is never taken as the new invoice', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  // Number 7 was issued by another system and is not synced yet; the app reserves 7 next.
  await issueExportOnFake(t.fake, { number: 7, amounts: { serviceCents: 999 } });
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers,
    payload: {
      templateInvoiceId,
      competence: '2026-09-30',
      serviceCents: 617000,
      foreignAmountCents: 123400,
    },
  });
  expect(response.json()).toMatchObject({ status: 'rejected', errors: [{ code: 'E0014' }] });
});

test('the exchange rate route returns the PTAX sell closing rate', async () => {
  const ptax = new MockAgent();
  ptax.disableNetConnect();
  ptax
    .get('https://olinda.bcb.gov.br')
    .intercept({ path: (p) => p.includes('08-31-2026'), method: 'GET' })
    .reply(200, {
      value: [{ tipoBoletim: 'Fechamento PTAX', cotacaoVenda: 5.4321, cotacaoCompra: 5.181 }],
    });
  const own = await createTestApp({ ptaxDispatcher: ptax });
  const a = seedTenant(own.db, { accountName: 'A', email: 'x@example.com' });
  const response = await own.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/exchange-rate?currency=220&date=2026-08-31`,
    headers: await own.as('x@example.com'),
  });
  await own.close();
  expect(response.json()).toEqual({
    currency: 'USD',
    date: '2026-08-31',
    rate: '5.4321',
    rateE4: 54321,
    source: 'PTAX venda, fechamento',
  });
});

test('a DPS number used outside the app for the same amount but another customer is not ours', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  await issueExportOnFake(t.fake, {
    number: 7,
    competence: '2026-09-30',
    amounts: { serviceCents: 617000 },
    customer: { document: { type: 'NIF', value: '99-9999999' }, name: 'Another Customer LLC' },
  });
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers,
    payload: {
      templateInvoiceId,
      competence: '2026-09-30',
      serviceCents: 617000,
      foreignAmountCents: 123400,
    },
  });
  expect(response.json()).toMatchObject({ status: 'rejected', errors: [{ code: 'E0014' }] });
});

test('a direct issue is ours even when the Sefin normalizes the description', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers,
    payload: {
      templateInvoiceId,
      competence: '2026-09-30',
      serviceCents: 617000,
      foreignAmountCents: 123400,
      description: 'Linha 1\r\nLinha 2 ',
    },
  });
  expect(response.json()).toMatchObject({ status: 'issued' });
});

test('the same Idempotency-Key twice issues once and answers the same invoice', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const request = {
    method: 'POST' as const,
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers: { ...headers, 'idempotency-key': 'form-0001-abcdef' },
    payload: {
      templateInvoiceId,
      competence: '2026-09-30',
      serviceCents: 617000,
      foreignAmountCents: 123400,
    },
  };
  const first = await t.app.inject(request);
  const second = await t.app.inject(request);
  expect(first.statusCode).toBe(201);
  expect(second.statusCode).toBe(200);
  expect(second.json()).toEqual(first.json());
  const list = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices`,
    headers,
  });
  expect(list.json()).toMatchObject({ total: 2 });
});

test('two requests with one key at the same time make one invoice', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const request = {
    method: 'POST' as const,
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers: { ...headers, 'idempotency-key': 'form-0002-abcdef' },
    payload: {
      templateInvoiceId,
      competence: '2026-09-30',
      serviceCents: 100,
      foreignAmountCents: 20,
    },
  };
  const [one, two] = await Promise.all([t.app.inject(request), t.app.inject(request)]);
  expect(one.json().id).toBe(two.json().id);
  const list = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices`,
    headers,
  });
  expect(list.json()).toMatchObject({ total: 2 });
});

test('a malformed Idempotency-Key is 400', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers: { ...headers, 'idempotency-key': 'x' },
    payload: {
      templateInvoiceId,
      competence: '2026-09-30',
      serviceCents: 100,
      foreignAmountCents: 20,
    },
  });
  expect(response.json()).toEqual({ error: 'invalid_idempotency_key' });
});

test('issue similar also takes the amount in reais from the PTAX of the competence', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const send = (serviceCents: number) =>
    t.app.inject({
      method: 'POST',
      url: `/api/accounts/${a.accountId}/invoices/issue`,
      headers,
      payload: {
        templateInvoiceId,
        competence: '2026-09-30',
        serviceCents,
        foreignAmountCents: 200,
      },
    });
  const wrong = await send(999);
  expect(wrong.statusCode).toBe(400);
  // The test app's PTAX is 5.0000: 2.00 USD = 10.00 BRL.
  expect(wrong.json()).toMatchObject({ error: 'amount_ptax_mismatch', expectedCents: 1000 });
  expect((await send(1000)).json()).toMatchObject({ status: 'issued' });
});
