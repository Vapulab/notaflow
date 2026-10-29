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
  customerEmail: null,
  customerEmailedAt: null,
  customerEmailProblem: null,
  autoEmailCustomer: false,
  hasLink: false,
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

test('the detail shows when the customer was e-mailed', async () => {
  stubApi({
    '/api/accounts/acc/invoices/inv1': {
      ...issuedInvoice,
      customerEmail: 'cliente@example.com',
      customerEmailedAt: '2026-10-02T15:30:00.000Z',
      autoEmailCustomer: true,
    },
  });
  renderWithMe(<InvoiceDetailPage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  expect(await screen.findByText('E-mail enviado em 02/10/2026 12:30')).toBeTruthy();
});

test('a bounced e-mail shows endereço inválido with the address', async () => {
  stubApi({
    '/api/accounts/acc/invoices/inv1': {
      ...issuedInvoice,
      customerEmail: 'erro@exemplo.com',
      customerEmailedAt: '2026-10-02T15:30:00.000Z',
      customerEmailProblem: { kind: 'invalid_address', to: 'erro@exemplo.com' },
      autoEmailCustomer: true,
    },
  });
  renderWithMe(<InvoiceDetailPage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  expect(
    await screen.findByText('E-mail não entregue: endereço inválido (erro@exemplo.com)'),
  ).toBeTruthy();
  expect(screen.queryByText(/E-mail enviado/)).toBeNull();
});

test('the detail says the customer has no e-mail on the note for an app invoice in production', async () => {
  stubApi({
    '/api/accounts/acc/invoices/inv1': {
      ...issuedInvoice,
      environment: 'producao',
      autoEmailCustomer: true,
    },
  });
  renderWithMe(<InvoiceDetailPage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  expect(await screen.findByText('Tomador sem e-mail na nota')).toBeTruthy();
});

test('with the setting off the detail says nothing about the e-mail', async () => {
  stubApi({ '/api/accounts/acc/invoices/inv1': issuedInvoice });
  renderWithMe(<InvoiceDetailPage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  await screen.findByRole('link', { name: 'Emitir parecida' });
  expect(screen.queryByText('Tomador sem e-mail na nota')).toBeNull();
});

test('a synced invoice or a test invoice never shows the missing-address notice', async () => {
  for (const change of [{ origin: 'synced' }, { environment: 'producao_restrita' }]) {
    stubApi({
      '/api/accounts/acc/invoices/inv1': {
        ...issuedInvoice,
        environment: 'producao',
        autoEmailCustomer: true,
        ...change,
      },
    });
    const view = renderWithMe(
      <InvoiceDetailPage accountId="acc" invoiceId="inv1" />,
      meFor('admin'),
    );
    await screen.findByRole('link', { name: 'Emitir parecida' });
    expect(screen.queryByText('Tomador sem e-mail na nota')).toBeNull();
    view.unmount();
  }
});

const LINK_PATH = '/api/accounts/acc/invoices/inv1/link';

test('"Revogar link" shows only when a link exists, asks to confirm, and calls DELETE', async () => {
  let hasLink = true;
  const calls = stubApi({
    [LINK_PATH]: (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') hasLink = false;
      return { url: 'https://notaflow.vapulab.com/n/tok' };
    },
    '/api/accounts/acc/invoices/inv1': () => ({ ...issuedInvoice, hasLink }),
    '/api/accounts/acc/emitters': [{ id: 'em1', companyName: 'Vapulab Ltda' }],
  });
  renderWithMe(<InvoiceDetailPage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Revogar link' }));
  const dialog = screen.getByRole('dialog');
  expect(
    within(dialog).getByText(
      'Quem já recebeu o link perde o acesso ao PDF. Um novo link pode ser criado depois.',
    ),
  ).toBeTruthy();
  expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false);
  await user.click(within(dialog).getByRole('button', { name: 'Revogar' }));
  await waitFor(() => expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(true));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Revogar link' })).toBeNull());
});

test('no "Revogar link" without a link', async () => {
  stubApi({ '/api/accounts/acc/invoices/inv1': issuedInvoice });
  renderWithMe(<InvoiceDetailPage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  await screen.findByRole('link', { name: 'Emitir parecida' });
  expect(screen.queryByRole('button', { name: 'Revogar link' })).toBeNull();
});

test('after a revoke the share panel asks for a new link instead of reusing the old one', async () => {
  let n = 0;
  let hasLink = false;
  const calls = stubApi({
    [LINK_PATH]: (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        hasLink = false;
        return {};
      }
      hasLink = true;
      n += 1;
      return { url: `https://notaflow.vapulab.com/n/tok${n}` };
    },
    '/api/accounts/acc/invoices/inv1': () => ({ ...issuedInvoice, hasLink }),
    '/api/accounts/acc/emitters': [{ id: 'em1', companyName: 'Vapulab Ltda' }],
  });
  renderWithMe(<InvoiceDetailPage accountId="acc" invoiceId="inv1" />, meFor('admin'));
  const user = userEvent.setup();
  vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await user.click(await screen.findByRole('button', { name: 'Copiar link' }));
  await user.click(await screen.findByRole('button', { name: 'Revogar link' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revogar' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Revogar link' })).toBeNull());
  await user.click(screen.getByRole('button', { name: 'Copiar link' }));
  await waitFor(() =>
    expect(calls.filter((c) => c.init?.method === 'POST' && c.url === LINK_PATH)).toHaveLength(2),
  );
});
