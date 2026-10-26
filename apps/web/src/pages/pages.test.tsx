// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { stubApi } from '../test/stubApi';
import { InvoicesPage } from './InvoicesPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const invoice = {
  id: 'inv1',
  emitterId: 'em1',
  accessKey: 'K'.repeat(50),
  number: '3',
  status: 'cancelled',
  environment: 'producao',
  issuedAt: '2026-09-02T16:12:54.000Z',
  competence: '2026-08-31',
  customerDocument: '00-0000000',
  customerName: 'Foreign Customer Inc',
  serviceCode: '010701',
  description: 'Serviços de TI',
  serviceCents: 670321,
  issCents: null,
  netCents: 670321,
};

test('lists invoices with BRL amounts and the cancelled status', async () => {
  stubApi({
    '/api/accounts/acc/invoices': { items: [invoice], total: 1 },
    '/api/accounts/acc/emitters': [],
  });
  render(<InvoicesPage accountId="acc" />);
  expect(await screen.findByText('Foreign Customer Inc')).toBeTruthy();
  expect(screen.getByText(/6\.703,21/)).toBeTruthy();
  expect(screen.getByRole('cell', { name: /cancelada/i })).toBeTruthy();
});

test('the lookup posts the key and opens the found invoice', async () => {
  const calls = stubApi({
    '/api/accounts/acc/invoices/lookup': { id: 'inv1' },
    '/api/accounts/acc/invoices': { items: [], total: 0 },
    '/api/accounts/acc/emitters': [],
  });
  render(<InvoicesPage accountId="acc" />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/chave de acesso/i), 'K'.repeat(50));
  await user.click(screen.getByRole('button', { name: /buscar/i }));
  await waitFor(() =>
    expect(window.location.pathname + window.location.search).toBe('/app/acc/notas/inv1'),
  );
  expect(calls.find((c) => c.url.endsWith('/lookup'))?.init?.body).toBe(
    JSON.stringify({ accessKey: 'K'.repeat(50) }),
  );
});

test('each issued or cancelled invoice has Emitir parecida and PDF in the list', async () => {
  stubApi({
    '/api/accounts/acc/invoices': { items: [invoice], total: 1 },
    '/api/accounts/acc/emitters': [],
  });
  render(<InvoicesPage accountId="acc" />);
  const link = await screen.findByRole('link', { name: 'Emitir parecida' });
  expect(link.getAttribute('href')).toBe('/app/acc/notas/inv1/emitir');
  expect(screen.getByRole('button', { name: 'PDF' })).toBeTruthy();
});

test('a click on the row opens the invoice; the list has no number or environment column', async () => {
  stubApi({
    '/api/accounts/acc/invoices': { items: [invoice], total: 1 },
    '/api/accounts/acc/emitters': [],
  });
  render(<InvoicesPage accountId="acc" />);
  const user = userEvent.setup();
  const row = (await screen.findByText('Foreign Customer Inc')).closest('tr');
  expect(screen.queryByRole('columnheader', { name: 'Número' })).toBeNull();
  expect(screen.queryByRole('columnheader', { name: 'Ambiente' })).toBeNull();
  await user.click(row as HTMLElement);
  expect(window.location.pathname + window.location.search).toBe('/app/acc/notas/inv1');
});

test('the row opens with Enter, and its buttons do not open it', async () => {
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }),
  );
  stubApi({
    '/api/accounts/acc/invoices/inv1/danfse': { error: 'not_found' },
    '/api/accounts/acc/invoices': { items: [invoice], total: 1 },
    '/api/accounts/acc/emitters': [],
  });
  render(<InvoicesPage accountId="acc" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'PDF' }));
  expect(window.location.pathname + window.location.search).toBe('/');
  const row = screen.getByText('Foreign Customer Inc').closest('tr') as HTMLElement;
  row.focus();
  await user.keyboard('{Enter}');
  expect(window.location.pathname + window.location.search).toBe('/app/acc/notas/inv1');
});

test('a produção restrita invoice carries a Teste badge; a production one does not', async () => {
  stubApi({
    '/api/accounts/acc/invoices': {
      items: [
        invoice,
        { ...invoice, id: 'inv2', customerName: 'Teste Ltda', environment: 'producao_restrita' },
      ],
      total: 2,
    },
    '/api/accounts/acc/emitters': [],
  });
  render(<InvoicesPage accountId="acc" />);
  const testRow = (await screen.findByText('Teste Ltda')).closest('tr') as HTMLElement;
  const prodRow = screen.getByText('Foreign Customer Inc').closest('tr') as HTMLElement;
  expect(within(testRow).getByText('Teste')).toBeTruthy();
  expect(within(prodRow).queryByText('Teste')).toBeNull();
});

test('the invoice list links to Nova nota', async () => {
  stubApi({
    '/api/accounts/acc/invoices': { items: [], total: 0 },
    '/api/accounts/acc/emitters': [],
  });
  render(<InvoicesPage accountId="acc" />);
  const link = await screen.findByRole('link', { name: 'Nova nota' });
  expect(link.getAttribute('href')).toBe('/app/acc/notas/nova');
});
