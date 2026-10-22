// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { stubApi } from '../test/stubApi';
import { AdminPage } from './AdminPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const waitlist = {
  signups: [
    {
      id: 'w-1',
      email: 'maria@example.com',
      interests: ['mei', 'certificate'],
      sourcePage: '/guia/mei',
      createdAt: '2026-10-20T12:00:00Z',
    },
  ],
  counts: { mei: 3, lucro_presumido: 1, certificate: 2 },
};

const routes = {
  '/api/admin/waitlist': waitlist,
  '/api/admin/accounts': [
    { id: 'acc-1', name: 'Vapulab', status: 'active', plan: 'free', members: 1 },
    { id: 'acc-2', name: 'Outra Empresa', status: 'active', plan: 'free', members: 0 },
  ],
  '/api/admin/users?q=tal': [
    { id: 'u-2', email: 'talita@example.com', name: 'Talita', platformRole: 'user' },
  ],
  '/api/admin/users': [
    {
      id: 'u-1',
      email: 'lincoln@example.com',
      name: 'Lincoln',
      platformRole: 'admin',
      lastLoginAt: '2026-10-10T16:00:00Z',
    },
    {
      id: 'u-2',
      email: 'talita@example.com',
      name: 'Talita',
      platformRole: 'user',
      lastLoginAt: null,
    },
  ],
  '/api/admin/audit': [
    {
      id: 1,
      userEmail: 'lincoln@example.com',
      accountId: null,
      action: 'account.create',
      entity: 'acc-1',
      result: 'ok',
      detail: null,
      at: '2026-10-10T14:11:24Z',
    },
  ],
  '/api/admin/accounts/acc-2/members/u-2': null,
};

test('linking picks the account by name and finds the user by name, then sends their ids', async () => {
  const calls = stubApi(routes);
  render(<AdminPage />);
  const user = userEvent.setup();
  const form = (await screen.findByRole('heading', { name: /vincular usuário/i })).closest(
    'form',
  ) as HTMLElement;
  await user.selectOptions(within(form).getByLabelText(/^conta/i), 'acc-2');
  // One field: type to search, then pick from the list right below it.
  const combo = within(form).getByRole('combobox', { name: /usuário/i });
  expect(within(form).queryByLabelText(/buscar usuário/i)).toBeNull();
  await user.type(combo, 'tal');
  const option = await within(form).findByRole('option', { name: /talita@example.com/ });
  // The search reruns per keystroke; an earlier answer can still list lincoln for a moment.
  await waitFor(() =>
    expect(within(form).queryByRole('option', { name: /lincoln@example.com/ })).toBeNull(),
  );
  await user.click(option);
  expect((combo as HTMLInputElement).value).toBe('Talita (talita@example.com)');
  await user.selectOptions(within(form).getByLabelText(/^papel/i), 'member');
  await user.click(within(form).getByRole('button', { name: 'Salvar' }));
  await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT')).toBe(true));
  const put = calls.find((c) => c.init?.method === 'PUT');
  expect(put?.url).toBe('/api/admin/accounts/acc-2/members/u-2');
  expect(JSON.parse(String(put?.init?.body))).toEqual({ role: 'member' });
});

test('the audit log shows the time of each entry', async () => {
  stubApi(routes);
  render(<AdminPage />);
  expect(await screen.findByText(/10\/10\/2026 11:11/)).toBeTruthy();
});

test('the user combobox works by keyboard', async () => {
  stubApi(routes);
  render(<AdminPage />);
  const user = userEvent.setup();
  const combo = await screen.findByRole('combobox', { name: /usuário/i });
  await user.type(combo, 'tal');
  await screen.findByRole('option', { name: /talita@example.com/ });
  await user.keyboard('{ArrowDown}{Enter}');
  expect((combo as HTMLInputElement).value).toBe('Talita (talita@example.com)');
  expect(combo.getAttribute('aria-expanded')).toBe('false');
});

test('the users table shows each last access, or nunca', async () => {
  stubApi(routes);
  render(<AdminPage />);
  const table = (await screen.findByRole('heading', { name: 'Usuários' })).closest(
    'section',
  ) as HTMLElement;
  const lincoln = (await within(table).findByText('lincoln@example.com')).closest(
    'tr',
  ) as HTMLElement;
  expect(within(lincoln).getByText('10/10/2026 13:00')).toBeTruthy();
  const talita = within(table).getByText('talita@example.com').closest('tr') as HTMLElement;
  expect(within(talita).getByText('nunca')).toBeTruthy();
});

test('the e-mails that failed for good can be resent, except login codes', async () => {
  const calls = stubApi({
    ...routes,
    '/api/admin/mail/failed': [
      {
        id: 7,
        kind: 'invite',
        to: 'convidado@example.com',
        subject: 'Convite para a conta Vapulab no NotaFlow',
        attempts: 5,
        lastError: 'Error: Resend answered 503',
        createdAt: '2026-10-11T12:00:00Z',
      },
      {
        id: 8,
        kind: 'code',
        to: 'pessoa@example.com',
        subject: 'Seu código de acesso ao NotaFlow',
        attempts: 2,
        lastError: 'code expired',
        createdAt: '2026-10-11T12:05:00Z',
      },
    ],
    '/api/admin/mail/7/retry': { sent: true },
  });
  render(<AdminPage />);
  const section = within(await screen.findByRole('region', { name: 'E-mails não entregues' }));
  expect(await section.findByText('convidado@example.com')).toBeTruthy();
  expect(section.getByText('Error: Resend answered 503')).toBeTruthy();
  expect(section.getAllByRole('button', { name: 'Reenviar' })).toHaveLength(1);
  expect(section.getByText('Código expirado, não se reenvia')).toBeTruthy();
  await userEvent.setup().click(section.getByRole('button', { name: 'Reenviar' }));
  await waitFor(() =>
    expect(
      calls.some((c) => c.url === '/api/admin/mail/7/retry' && c.init?.method === 'POST'),
    ).toBe(true),
  );
  expect(await section.findByText('E-mail reenviado.')).toBeTruthy();
});

test('the waitlist shows the counts and the rows, and removing one asks first', async () => {
  const calls = stubApi({ ...routes, '/api/admin/waitlist/w-1': null });
  vi.stubGlobal('confirm', vi.fn(() => true));
  render(<AdminPage />);
  const section = within(await screen.findByRole('region', { name: 'Lista de espera' }));
  expect(await section.findByText('maria@example.com')).toBeTruthy();
  expect(section.getByText('MEI: 3')).toBeTruthy();
  expect(section.getByText('Lucro presumido: 1')).toBeTruthy();
  expect(section.getByText('Certificado A1: 2')).toBeTruthy();
  expect(section.getByText('/guia/mei')).toBeTruthy();
  await userEvent.setup().click(section.getByRole('button', { name: 'Remover' }));
  await waitFor(() =>
    expect(
      calls.some((c) => c.url === '/api/admin/waitlist/w-1' && c.init?.method === 'DELETE'),
    ).toBe(true),
  );
  expect(window.confirm).toHaveBeenCalled();
});

test('declining the confirm keeps the waitlist row', async () => {
  const calls = stubApi({ ...routes, '/api/admin/waitlist/w-1': null });
  vi.stubGlobal('confirm', vi.fn(() => false));
  render(<AdminPage />);
  const section = within(await screen.findByRole('region', { name: 'Lista de espera' }));
  await userEvent.setup().click(await section.findByRole('button', { name: 'Remover' }));
  expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false);
});
