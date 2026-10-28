// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { installDialogPolyfill } from '../test/dialog';
import { stubApi } from '../test/stubApi';
import { meFor, renderWithMe } from '../test/renderWithMe';
import { InvoiceDetailPage } from './InvoiceDetailPage';

beforeAll(() => installDialogPolyfill());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const issuedInvoice = {
  id: 'inv1',
  emitterId: 'em1',
  accessKey: 'K'.repeat(50),
  number: '7',
  status: 'issued',
  environment: 'producao_restrita',
  issuedAt: '2026-10-01T13:00:00.000Z',
  competence: '2026-09-30',
  customerDocument: '98765432000110',
  customerName: 'Cliente Exemplo Ltda',
  serviceCode: '010101',
  description: 'Consultoria',
  serviceCents: 670321,
  issCents: null,
  netCents: 670321,
  origin: 'app',
  events: [],
  sefinMessages: null,
  templateOf: null,
};

test('an issued invoice links to issue similar', async () => {
  stubApi({ '/api/accounts/acc/invoices/inv1': issuedInvoice });
  renderWithMe(<InvoiceDetailPage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  const link = await screen.findByRole('link', { name: 'Emitir parecida' });
  expect(link.getAttribute('href')).toBe('/app/acc/notas/inv1/emitir');
});

test('cancel in production names the environment and needs a 15-character justification', async () => {
  const calls = stubApi({
    '/api/accounts/acc/invoices/inv1/cancel': { id: 'inv1', status: 'cancelled' },
    '/api/accounts/acc/invoices/inv1': { ...issuedInvoice, environment: 'producao' },
  });
  renderWithMe(<InvoiceDetailPage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Cancelar nota' }));
  const dialog = screen.getByRole('dialog', { name: /cancelar/i });
  expect(within(dialog).getByText('PRODUÇÃO')).toBeTruthy();
  const confirm = within(dialog).getByRole('button', { name: 'Cancelar em PRODUÇÃO' });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  await user.type(within(dialog).getByLabelText(/justificativa/i), 'Valor do serviço incorreto');
  expect((confirm as HTMLButtonElement).disabled).toBe(false);
  await user.click(confirm);
  await waitFor(() => expect(calls.some((c) => c.url.endsWith('/cancel'))).toBe(true));
  expect(JSON.parse(String(calls.find((c) => c.url.endsWith('/cancel'))?.init?.body))).toEqual({
    reason: '1',
    justification: 'Valor do serviço incorreto',
  });
});

test('a Sefin refusal shows its code and message in the dialog', async () => {
  stubApi({
    '/api/accounts/acc/invoices/inv1/cancel': {
      error: 'sefin_rejected',
      code: 'E1235',
      message: 'Prazo de cancelamento expirado',
    },
    '/api/accounts/acc/invoices/inv1': issuedInvoice,
  });
  renderWithMe(<InvoiceDetailPage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Cancelar nota' }));
  const dialog = screen.getByRole('dialog', { name: /cancelar/i });
  await user.type(within(dialog).getByLabelText(/justificativa/i), 'Valor do serviço incorreto');
  await user.click(within(dialog).getByRole('button', { name: /cancelar em produção restrita/i }));
  expect(await within(dialog).findByText(/E1235: Prazo de cancelamento expirado/)).toBeTruthy();
});

test('an already cancelled answer says so', async () => {
  stubApi({
    '/api/accounts/acc/invoices/inv1/cancel': {
      id: 'inv1',
      status: 'cancelled',
      alreadyCancelled: true,
    },
    '/api/accounts/acc/invoices/inv1': issuedInvoice,
  });
  renderWithMe(<InvoiceDetailPage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Cancelar nota' }));
  const dialog = screen.getByRole('dialog', { name: /cancelar/i });
  await user.type(within(dialog).getByLabelText(/justificativa/i), 'Valor do serviço incorreto');
  await user.click(within(dialog).getByRole('button', { name: /cancelar em produção restrita/i }));
  expect(await screen.findByText(/já estava cancelada/i)).toBeTruthy();
});

test('an unknown invoice offers Verificar na Sefin and lists the Sefin messages', async () => {
  const calls = stubApi({
    '/api/accounts/acc/invoices/inv1/reconcile': { id: 'inv1', status: 'issued' },
    '/api/accounts/acc/invoices/inv1': {
      ...issuedInvoice,
      status: 'unknown',
      sefinMessages: [{ code: 'uncertain', message: 'timeout' }],
    },
  });
  renderWithMe(<InvoiceDetailPage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  const user = userEvent.setup();
  expect(await screen.findByText(/timeout/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Cancelar nota' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Verificar na Sefin' }));
  await waitFor(() => expect(calls.some((c) => c.url.endsWith('/reconcile'))).toBe(true));
});

test('the detail downloads the DANFS-e PDF', async () => {
  const created: Blob[] = [];
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        created.push(blob);
        return 'blob:x';
      },
      revokeObjectURL: () => {},
    }),
  );
  stubApi({
    '/api/accounts/acc/invoices/inv1/danfse': 'PDF',
    '/api/accounts/acc/invoices/inv1': issuedInvoice,
  });
  renderWithMe(<InvoiceDetailPage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /baixar pdf/i }));
  await waitFor(() => expect(created).toHaveLength(1));
});

test('a customer cancels a production invoice with Cancelar nota, without the environment', async () => {
  stubApi({ '/api/accounts/acc/invoices/inv1': { ...issuedInvoice, environment: 'producao' } });
  renderWithMe(<InvoiceDetailPage accountId="acc" invoiceId="inv1" />, meFor('user'));
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Cancelar nota' }));
  const dialog = screen.getByRole('dialog', { name: /cancelar/i });
  expect(within(dialog).queryByText('PRODUÇÃO')).toBeNull();
  expect(within(dialog).getByRole('button', { name: 'Confirmar cancelamento' })).toBeTruthy();
});

test('the share buttons show for an issued or cancelled invoice, not a rejected one', async () => {
  const emitters = [{ id: 'em1', companyName: 'Vapulab Ltda' }];
  for (const [status, shown] of [
    ['issued', true],
    ['cancelled', true],
    ['rejected', false],
  ] as const) {
    stubApi({
      '/api/accounts/acc/emitters': emitters,
      '/api/accounts/acc/invoices/inv1': { ...issuedInvoice, status },
    });
    const view = renderWithMe(
      <InvoiceDetailPage accountId="acc" invoiceId="inv1" />,
      meFor('admin'),
    );
    await screen.findByText(/NFS-e 7/);
    await waitFor(() =>
      expect(!!screen.queryByRole('button', { name: 'Copiar link' })).toBe(shown),
    );
    expect(!!screen.queryByRole('button', { name: 'Compartilhar' })).toBe(shown);
    view.unmount();
  }
});
