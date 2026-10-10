// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { brasiliaToday, previousMonthEnd } from '../format';
import { installDialogPolyfill } from '../test/dialog';
import { meFor, renderWithMe } from '../test/renderWithMe';
import { type StubCall, stubApi } from '../test/stubApi';
import { NewInvoicePage } from './NewInvoicePage';

const KEY = '11111111-1111-4111-8111-111111111111';

beforeAll(installDialogPolyfill);
beforeEach(() => {
  vi.spyOn(crypto, 'randomUUID')
    .mockReturnValueOnce(KEY)
    .mockReturnValue('22222222-2222-4222-8222-222222222222');
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = '';
});

const emitter = {
  id: 'em1',
  cnpj: '12345678000195',
  companyName: 'EMPRESA TESTE LTDA',
  environment: 'producao',
  municipality: '4113700',
  dpsSeries: '900',
  certificate: null,
};
const bands = {
  III: [600, 1120, 1350, 1600, 2100, 3300],
  V: [1550, 1800, 1950, 2050, 2300, 3050],
};
const fiscal = {
  simplesAnnex: 'III',
  simplesBand: 2,
  simplesPercent: 1120,
  issRate: 200,
  ibscbsRegime: 'inside_das',
  ibscbsRegimeFrom: null,
  bands,
};
const service = {
  id: 's1',
  emitterId: 'em1',
  name: 'Desenvolvimento',
  nationalTaxCode: '010101',
  description: 'Desenvolvimento de software',
  origin: 'manual',
  archived: false,
};
const brazil = {
  id: 'c1',
  emitterId: 'em1',
  documentType: 'CNPJ',
  document: '11222333000181',
  name: 'Cliente Teste Ltda',
  email: null,
  phone: null,
  municipalRegistration: null,
  address: {
    kind: 'domestic',
    municipality: '4113700',
    zip: '86010000',
    street: 'R',
    number: '1',
    district: 'C',
  },
  origin: 'manual',
  archived: false,
};
const abroad = {
  ...brazil,
  id: 'c2',
  documentType: 'NIF',
  document: '00-0000000',
  name: 'Foreign Customer Inc',
  address: {
    kind: 'foreign',
    country: 'US',
    postalCode: '1',
    city: 'X',
    region: 'NY',
    street: 'S',
    number: '1',
    district: 'D',
  },
};
const base = '/api/accounts/acc';
const routes = (overrides: Record<string, unknown> = {}) => ({
  [`${base}/emitters`]: [emitter],
  [`${base}/emitters/em1/fiscal`]: fiscal,
  [`${base}/emitters/em1/services`]: [service],
  [`${base}/customers`]: [brazil, abroad],
  [`${base}/exchange-rate`]: {
    currency: 'USD',
    date: '2026-09-30',
    rate: '5.4321',
    rateE4: 54321,
    source: 'PTAX venda, fechamento',
  },
  ...overrides,
});
const sent = (calls: StubCall[]) =>
  calls.filter((c) => c.url.endsWith('/invoices/new') && c.init?.method === 'POST');

type User = ReturnType<typeof userEvent.setup>;

async function pickCustomer(user: User, name: string) {
  await user.type(await screen.findByRole('combobox', { name: 'Cliente' }), name.slice(0, 4));
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

async function fillBrazil(user: User) {
  await pickCustomer(user, 'Cliente Teste Ltda');
  await user.selectOptions(screen.getByLabelText('Serviço'), 's1');
  await user.type(screen.getByLabelText('Valor em reais'), '1.234,00');
}

test('the route parses new before an invoice id; the page starts with today rules', async () => {
  stubApi(routes());
  renderWithMe(<NewInvoicePage accountId="acc" />, meFor('user'));
  const competence = (await screen.findByLabelText('Competência')) as HTMLInputElement;
  expect(competence.value).toBe(previousMonthEnd(brasiliaToday()));
  expect(competence.max).toBe(brasiliaToday());
  expect(screen.queryByLabelText('Emitente')).toBeNull();
});

test('without a fiscal configuration the owner gets a link and a member is told to ask', async () => {
  stubApi(
    routes({
      [`${base}/emitters/em1/fiscal`]: {
        ...fiscal,
        simplesPercent: null,
        simplesAnnex: null,
        simplesBand: null,
      },
    }),
  );
  const owner = renderWithMe(<NewInvoicePage accountId="acc" />, meFor('user'));
  const link = await screen.findByRole('link', { name: 'Configurar o emitente' });
  expect(link.getAttribute('href')).toBe('#/a/acc/emitters/em1');
  expect(screen.queryByLabelText('Competência')).toBeNull();
  owner.unmount();
  renderWithMe(<NewInvoicePage accountId="acc" />, meFor('user', 'member'));
  expect(await screen.findByText(/Peça ao dono da conta/)).toBeTruthy();
});

test('a Brazil invoice: the service fills the description, and the default band is not sent', async () => {
  const calls = stubApi(
    routes({ [`${base}/invoices/new`]: { id: 'new1', status: 'issued', number: '7' } }),
  );
  renderWithMe(<NewInvoicePage accountId="acc" />, meFor('user'));
  const user = userEvent.setup();
  await fillBrazil(user);
  expect((screen.getByLabelText('Descrição') as HTMLTextAreaElement).value).toBe(
    'Desenvolvimento de software',
  );
  expect((screen.getByLabelText('Faixa do Simples') as HTMLSelectElement).value).toBe('2');
  expect(screen.getByText('ISS no DAS (não retido)')).toBeTruthy();
  expect(screen.queryByLabelText('Moeda')).toBeNull();
  expect(calls.some((c) => c.url.includes('/customers?emitterId=em1&q=Clie'))).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Revisar' }));
  const review = screen.getByRole('table');
  expect(within(review).getByText('Cliente Teste Ltda')).toBeTruthy();
  expect(within(review).getByText('Faixa 2 – 11,20%')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Emitir nota' }));
  await waitFor(() => expect(window.location.hash).toBe('#/a/acc/invoices/new1'));
  const [post] = sent(calls);
  expect(new Headers(post?.init?.headers).get('idempotency-key')).toBe(KEY);
  expect(JSON.parse(String(post?.init?.body))).toEqual({
    emitterId: 'em1',
    customerId: 'c1',
    serviceId: 's1',
    competence: previousMonthEnd(brasiliaToday()),
    serviceCents: 123400,
    description: 'Desenvolvimento de software',
  });
});

test('another band sends its percent', async () => {
  const calls = stubApi(routes({ [`${base}/invoices/new`]: { id: 'new1', status: 'issued' } }));
  renderWithMe(<NewInvoicePage accountId="acc" />, meFor('user'));
  const user = userEvent.setup();
  await fillBrazil(user);
  await user.selectOptions(screen.getByLabelText('Faixa do Simples'), '3');
  await user.click(screen.getByRole('button', { name: 'Revisar' }));
  await user.click(screen.getByRole('button', { name: 'Emitir nota' }));
  await waitFor(() => expect(sent(calls)).toHaveLength(1));
  expect(JSON.parse(String(sent(calls)[0]?.init?.body))).toMatchObject({ simplesPercent: 1350 });
});

test('a customer abroad: currency, foreign amount, and reais from the PTAX of the competence', async () => {
  const calls = stubApi(routes({ [`${base}/invoices/new`]: { id: 'new1', status: 'issued' } }));
  renderWithMe(<NewInvoicePage accountId="acc" />, meFor('user'));
  const user = userEvent.setup();
  await pickCustomer(user, 'Foreign Customer Inc');
  await user.selectOptions(screen.getByLabelText('Serviço'), 's1');
  expect(screen.getByText('Exportação: sem ISS')).toBeTruthy();
  expect((screen.getByLabelText('Moeda') as HTMLSelectElement).value).toBe('220');
  await user.type(screen.getByLabelText('Valor em USD'), '1.234,00');
  const brl = screen.getByLabelText('Valor em reais') as HTMLInputElement;
  expect(brl.readOnly).toBe(true);
  await waitFor(() => expect(brl.value).toBe('6.703,21'));
  expect(screen.getByText(/PTAX venda de 30\/09\/2026: 5,4321/)).toBeTruthy();
  const competence = previousMonthEnd(brasiliaToday());
  expect(calls.some((c) => c.url.endsWith(`/exchange-rate?currency=220&date=${competence}`))).toBe(
    true,
  );
  await user.click(screen.getByRole('button', { name: 'Revisar' }));
  await user.click(screen.getByRole('button', { name: 'Emitir nota' }));
  await waitFor(() => expect(sent(calls)).toHaveLength(1));
  expect(JSON.parse(String(sent(calls)[0]?.init?.body))).toMatchObject({
    customerId: 'c2',
    serviceCents: 670321,
    foreignCurrency: '220',
    foreignAmountCents: 123400,
  });
});

test('without the rate a customer abroad cannot be reviewed', async () => {
  stubApi(routes({ [`${base}/exchange-rate`]: { error: 'ptax_unavailable' } }));
  renderWithMe(<NewInvoicePage accountId="acc" />, meFor('user'));
  const user = userEvent.setup();
  await pickCustomer(user, 'Foreign Customer Inc');
  await user.selectOptions(screen.getByLabelText('Serviço'), 's1');
  await user.type(screen.getByLabelText('Valor em USD'), '100,00');
  expect(await screen.findByText(/cotação PTAX da competência/)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Revisar' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

test('+ Novo cliente opens the customer form for this emitter', async () => {
  stubApi(routes());
  renderWithMe(<NewInvoicePage accountId="acc" />, meFor('user'));
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '+ Novo cliente' }));
  const dialog = screen.getByRole('dialog', { name: 'Novo cliente' });
  expect(within(dialog).getByRole('radio', { name: 'Cliente no Brasil' })).toBeTruthy();
  expect(within(dialog).queryByLabelText('Emitente')).toBeNull();
});

test('a customer from the link starts selected', async () => {
  stubApi(routes({ [`${base}/customers/c1`]: brazil }));
  renderWithMe(<NewInvoicePage accountId="acc" customerId="c1" />, meFor('user'));
  expect(await screen.findByDisplayValue('Cliente Teste Ltda (11222333000181)')).toBeTruthy();
});

test('a Sefin refusal shows its codes and lets the user go back', async () => {
  stubApi(
    routes({
      [`${base}/invoices/new`]: {
        id: 'new1',
        status: 'rejected',
        errors: [{ code: 'E0625', message: 'Alíquota não permitida' }],
      },
    }),
  );
  renderWithMe(<NewInvoicePage accountId="acc" />, meFor('user'));
  const user = userEvent.setup();
  await fillBrazil(user);
  await user.click(screen.getByRole('button', { name: 'Revisar' }));
  await user.click(screen.getByRole('button', { name: 'Emitir nota' }));
  expect(await screen.findByText(/E0625: Alíquota não permitida/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Voltar e editar' }));
  expect(screen.getByLabelText('Competência')).toBeTruthy();
});

test('an unclear answer locks the review; a reload keeps the key and the values', async () => {
  const calls = stubApi(routes({ [`${base}/invoices/new`]: { error: 'http_524' } }));
  const first = renderWithMe(<NewInvoicePage accountId="acc" />, meFor('user'));
  const user = userEvent.setup();
  await fillBrazil(user);
  await user.click(screen.getByRole('button', { name: 'Revisar' }));
  await user.click(screen.getByRole('button', { name: 'Emitir nota' }));
  expect(await screen.findByText(/pode ter sido emitida/i)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Voltar e editar' })).toBeNull();
  first.unmount();
  renderWithMe(<NewInvoicePage accountId="acc" />, meFor('user'));
  expect(await screen.findByText('Cliente Teste Ltda')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
  await waitFor(() => expect(sent(calls)).toHaveLength(2));
  expect(sent(calls).map((c) => new Headers(c.init?.headers).get('idempotency-key'))).toEqual([
    KEY,
    KEY,
  ]);
});

test('a platform admin sees the environment on the confirm button', async () => {
  stubApi(routes());
  renderWithMe(<NewInvoicePage accountId="acc" />, meFor('admin'));
  const user = userEvent.setup();
  await fillBrazil(user);
  await user.click(screen.getByRole('button', { name: 'Revisar' }));
  expect(screen.getByRole('button', { name: 'Emitir em PRODUÇÃO' })).toBeTruthy();
});

async function openMore(user: User) {
  await user.click(screen.getByRole('button', { name: 'Mais opções' }));
}

test('Mais opções: a CNPJ customer may retain the ISS, prefilled with the emitter rate', async () => {
  const calls = stubApi(routes({ [`${base}/invoices/new`]: { id: 'new1', status: 'issued' } }));
  renderWithMe(<NewInvoicePage accountId="acc" />, meFor('user'));
  const user = userEvent.setup();
  await fillBrazil(user);
  await openMore(user);
  await user.click(screen.getByLabelText('ISS retido pelo cliente'));
  expect((screen.getByLabelText('Alíquota de ISS (%)') as HTMLInputElement).value).toBe('2,00');
  expect(screen.getByText('Mínimo para este serviço: 2,00%.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Revisar' }));
  expect(
    within(screen.getByRole('table')).getByText('ISS retido pelo cliente: 2,00%'),
  ).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Emitir nota' }));
  await waitFor(() => expect(sent(calls)).toHaveLength(1));
  expect(JSON.parse(String(sent(calls)[0]?.init?.body))).toMatchObject({
    issRetained: true,
    issRate: 200,
  });
});

test('Mais opções: the works subitems accept a rate below 2%', async () => {
  stubApi(
    routes({
      [`${base}/emitters/em1/services`]: [{ ...service, nationalTaxCode: '070202' }],
    }),
  );
  renderWithMe(<NewInvoicePage accountId="acc" />, meFor('user'));
  const user = userEvent.setup();
  await fillBrazil(user);
  await openMore(user);
  await user.click(screen.getByLabelText('ISS retido pelo cliente'));
  expect(screen.getByText('Mínimo para este serviço: acima de zero.')).toBeTruthy();
});

test('Mais opções: a customer abroad has no retention option', async () => {
  stubApi(routes());
  renderWithMe(<NewInvoicePage accountId="acc" />, meFor('user'));
  const user = userEvent.setup();
  await pickCustomer(user, 'Foreign Customer Inc');
  await user.selectOptions(screen.getByLabelText('Serviço'), 's1');
  await openMore(user);
  expect(screen.queryByLabelText('ISS retido pelo cliente')).toBeNull();
  expect(screen.getByLabelText('Modo de prestação')).toBeTruthy();
});

test('Mais opções: another Simples percent and changed service codes go as overrides', async () => {
  const calls = stubApi(
    routes({
      [`${base}/invoices/new`]: { id: 'new1', status: 'issued' },
      [`${base}/service-codes`]: [
        { code: '010701', description: 'Suporte técnico em informática.' },
      ],
    }),
  );
  renderWithMe(<NewInvoicePage accountId="acc" />, meFor('user'));
  const user = userEvent.setup();
  await fillBrazil(user);
  await openMore(user);
  await user.type(screen.getByLabelText('Outro percentual do Simples (%)'), '7,50');
  await user.type(screen.getByRole('combobox', { name: 'Código nacional' }), 'suporte');
  await user.click(
    await screen.findByRole('option', { name: '01.07.01 – Suporte técnico em informática.' }),
  );
  await user.type(screen.getByLabelText('NBS'), '115022000');
  await user.click(screen.getByRole('button', { name: 'Revisar' }));
  const table = within(screen.getByRole('table'));
  expect(table.getByText('Código nacional: 01.07.01')).toBeTruthy();
  expect(table.getByText('Percentual do Simples: 7,50%')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Emitir nota' }));
  await waitFor(() => expect(sent(calls)).toHaveLength(1));
  const body = JSON.parse(String(sent(calls)[0]?.init?.body)) as Record<string, unknown>;
  expect(body.simplesPercent).toBe(750);
  expect(body.overrides).toEqual({ nationalTaxCode: '010701', nbsCode: '115022000' });
});

test('a rate under the minimum of the service shows the minimum', async () => {
  stubApi(routes({ [`${base}/invoices/new`]: { error: 'invalid_iss_rate', minimum: '2.00' } }));
  renderWithMe(<NewInvoicePage accountId="acc" />, meFor('user'));
  const user = userEvent.setup();
  await fillBrazil(user);
  await openMore(user);
  await user.click(screen.getByLabelText('ISS retido pelo cliente'));
  await user.click(screen.getByRole('button', { name: 'Revisar' }));
  await user.click(screen.getByRole('button', { name: 'Emitir nota' }));
  expect(await screen.findByText(/A alíquota mínima deste serviço é 2,00%\./)).toBeTruthy();
});

test('Mais opções shows the IBS/CBS fields only for a customer abroad', async () => {
  stubApi(routes());
  renderWithMe(<NewInvoicePage accountId="acc" />, meFor('user'));
  const user = userEvent.setup();
  await fillBrazil(user);
  await openMore(user);
  expect(screen.queryByLabelText('CST do IBS/CBS')).toBeNull();
});

test('the result screen has one page header', async () => {
  stubApi(
    routes({
      [`${base}/invoices/new`]: {
        id: 'new1',
        status: 'rejected',
        errors: [{ code: 'E1', message: 'x' }],
      },
    }),
  );
  renderWithMe(<NewInvoicePage accountId="acc" />, meFor('user'));
  const user = userEvent.setup();
  await fillBrazil(user);
  await user.click(screen.getByRole('button', { name: 'Revisar' }));
  await user.click(screen.getByRole('button', { name: 'Emitir nota' }));
  await screen.findByText(/E1: x/);
  expect(screen.getAllByRole('banner')).toHaveLength(1);
});
