// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ERROR_TEXT } from '../components/Layout';
import { stubApi } from '../test/stubApi';
import { meFor, renderWithMe } from '../test/renderWithMe';
import { IssuePage } from './IssuePage';

const KEY = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  // A second call would give another key, so a test sees a key made per attempt.
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

const draft = {
  templateInvoiceId: 'inv1',
  emitterId: 'em1',
  competence: '2026-08-31',
  serviceCents: 500000,
  description: 'Serviços de TI',
  customer: { document: { type: 'NIF', value: '00-0000000' }, name: 'Foreign Customer Inc' },
  foreign: { currency: 'USD', currencyCode: '220', amountCents: 200000 },
};
const emitter = {
  id: 'em1',
  cnpj: '12345678000195',
  companyName: 'EMPRESA TESTE LTDA',
  environment: 'producao',
  municipality: '4113700',
  dpsSeries: '900',
  certificate: null,
};
const rate = (date: string, rateE4: number) => ({
  currency: 'USD',
  date,
  rate: (rateE4 / 10_000).toFixed(4),
  rateE4,
  source: 'PTAX venda, fechamento',
});

// The review waits for the PTAX of the competence, as a person would.
async function clickReview(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText(/PTAX venda de/);
  await user.click(screen.getByRole('button', { name: /revisar/i }));
}

// A PTAX of 2.5000 keeps the draft's 2000.00 USD at its 5000.00 BRL.
const base = {
  '/api/accounts/acc/exchange-rate': rate('2026-08-31', 25_000),
  '/api/accounts/acc/invoices/inv1/draft': draft,
  '/api/accounts/acc/emitters': [emitter],
  '/api/accounts/acc/customers': [],
};

test('the PTAX rate is fetched when the form opens and fills the BRL amount', async () => {
  const calls = stubApi({ ...base, '/api/accounts/acc/exchange-rate': rate('2026-08-31', 54321) });
  renderWithMe(<IssuePage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  expect(await screen.findByDisplayValue('10.864,20')).toBeTruthy();
  expect(screen.getByText(/PTAX venda de 31\/08\/2026: 5,4321/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /cotação ptax/i })).toBeNull();
  const competence = (screen.getByLabelText('Competência') as HTMLInputElement).value;
  expect(calls.some((c) => c.url.endsWith(`/exchange-rate?currency=220&date=${competence}`))).toBe(
    true,
  );
});

test('a new competence date fetches the rate of that date', async () => {
  stubApi({
    ...base,
    '/api/accounts/acc/exchange-rate': rate('2026-08-31', 54321),
    '/api/accounts/acc/exchange-rate?currency=220&date=2026-07-31': rate('2026-07-31', 50000),
  });
  renderWithMe(<IssuePage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  await screen.findByDisplayValue('10.864,20');
  fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-07-31' } });
  expect(await screen.findByDisplayValue('10.000,00')).toBeTruthy();
  expect(screen.getByText(/PTAX venda de 31\/07\/2026: 5,0000/)).toBeTruthy();
});

test('a new foreign amount refreshes the BRL amount, which is read-only for an export', async () => {
  stubApi({ ...base, '/api/accounts/acc/exchange-rate': rate('2026-08-31', 54321) });
  renderWithMe(<IssuePage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  const user = userEvent.setup();
  const brl = (await screen.findByDisplayValue('10.864,20')) as HTMLInputElement;
  expect(brl.readOnly).toBe(true);
  const foreign = screen.getByLabelText('Valor em USD');
  await user.clear(foreign);
  await user.type(foreign, '1.000,00');
  await waitFor(() => expect(brl.value).toBe('5.432,10'));
});

test('without the PTAX of the competence an export cannot be reviewed', async () => {
  stubApi({ ...base, '/api/accounts/acc/exchange-rate': { error: 'ptax_unavailable' } });
  renderWithMe(<IssuePage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  expect(await screen.findByText(ERROR_TEXT.ptax_unavailable ?? '')).toBeTruthy();
  expect((screen.getByRole('button', { name: /revisar/i }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

test('the review shows PRODUÇÃO, highlights changes, and sends one key on a retry', async () => {
  const calls = stubApi({
    ...base,
    '/api/accounts/acc/invoices/issue': { error: 'sefin_unavailable' },
  });
  renderWithMe(<IssuePage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  const user = userEvent.setup();
  const description = await screen.findByLabelText(/descrição/i);
  await user.clear(description);
  await user.type(description, 'Serviços de outubro');
  await clickReview(user);
  expect(screen.getByText('PRODUÇÃO')).toBeTruthy();
  expect(screen.getByRole('row', { name: /descrição/i }).className).toContain('bg-warning/10');
  expect(screen.getByRole('row', { name: /tomador/i }).className).not.toContain('bg-warning/10');
  await user.click(screen.getByRole('button', { name: /emitir em produção/i }));
  await user.click(await screen.findByRole('button', { name: /tentar de novo/i }));
  await waitFor(() =>
    expect(calls.filter((c) => c.url.endsWith('/invoices/issue'))).toHaveLength(2),
  );
  const keys = calls
    .filter((c) => c.url.endsWith('/invoices/issue'))
    .map((c) => new Headers(c.init?.headers).get('idempotency-key'));
  expect(keys).toEqual([KEY, KEY]);
});

test('an issued invoice opens its detail', async () => {
  stubApi({
    ...base,
    '/api/accounts/acc/invoices/issue': { id: 'new1', status: 'issued', number: '7' },
  });
  renderWithMe(<IssuePage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  const user = userEvent.setup();
  await clickReview(user);
  await user.click(screen.getByRole('button', { name: /emitir em produção/i }));
  await waitFor(() => expect(window.location.hash).toBe('#/a/acc/invoices/new1'));
});

test('after an uncertain send error the form cannot go back, and a retry keeps the key', async () => {
  const calls = stubApi({
    ...base,
    '/api/accounts/acc/invoices/issue': { error: 'sefin_unavailable' },
  });
  renderWithMe(<IssuePage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  const user = userEvent.setup();
  await clickReview(user);
  await user.click(screen.getByRole('button', { name: /emitir em produção/i }));
  expect(await screen.findByText(/pode ter sido emitida/i)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /voltar e editar/i })).toBeNull();
  await user.click(screen.getByRole('button', { name: /tentar de novo/i }));
  await waitFor(() =>
    expect(calls.filter((c) => c.url.endsWith('/invoices/issue'))).toHaveLength(2),
  );
  const keys = calls
    .filter((c) => c.url.endsWith('/invoices/issue'))
    .map((c) => new Headers(c.init?.headers).get('idempotency-key'));
  expect(keys).toEqual([KEY, KEY]);
});

test('a reload after an uncertain send keeps the key and the reviewed values', async () => {
  const calls = stubApi({ ...base, '/api/accounts/acc/invoices/issue': { error: 'http_524' } });
  const first = renderWithMe(<IssuePage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  const user = userEvent.setup();
  await clickReview(user);
  await user.click(screen.getByRole('button', { name: /emitir em produção/i }));
  expect(await screen.findByText(/pode ter sido emitida/i)).toBeTruthy();
  first.unmount();
  renderWithMe(<IssuePage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  await user.click(await screen.findByRole('button', { name: /tentar de novo/i }));
  await waitFor(() =>
    expect(calls.filter((c) => c.url.endsWith('/invoices/issue'))).toHaveLength(2),
  );
  const keys = calls
    .filter((c) => c.url.endsWith('/invoices/issue'))
    .map((c) => new Headers(c.init?.headers).get('idempotency-key'));
  expect(keys).toEqual([KEY, KEY]);
});

test('a validation refusal is definitive: the user can go back and edit', async () => {
  stubApi({ ...base, '/api/accounts/acc/invoices/issue': { error: 'invalid_amount' } });
  renderWithMe(<IssuePage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  const user = userEvent.setup();
  await clickReview(user);
  await user.click(screen.getByRole('button', { name: /emitir em produção/i }));
  expect(await screen.findByRole('button', { name: /voltar e editar/i })).toBeTruthy();
});

test('a customer reviews without the environment: no PRODUÇÃO, and the button says Emitir nota', async () => {
  stubApi(base);
  renderWithMe(<IssuePage accountId="acc" invoiceId="inv1" />, meFor('user'));
  const user = userEvent.setup();
  await clickReview(user);
  expect(screen.queryByText('PRODUÇÃO')).toBeNull();
  expect(screen.getByRole('button', { name: 'Emitir nota' })).toBeTruthy();
});
