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

const routes = {
  '/api/admin/accounts': [
    { id: 'acc-1', name: 'Vapulab', status: 'active', plan: 'free', members: 1 },
    { id: 'acc-2', name: 'Outra Empresa', status: 'active', plan: 'free', members: 0 },
  ],
  '/api/admin/users?q=tal': [
    { id: 'u-2', email: 'talita@example.com', name: 'Talita', platformRole: 'user' },
  ],
  '/api/admin/users': [
    { id: 'u-1', email: 'lincoln@example.com', name: 'Lincoln', platformRole: 'admin' },
    { id: 'u-2', email: 'talita@example.com', name: 'Talita', platformRole: 'user' },
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
  await user.type(within(form).getByLabelText(/buscar usuário/i), 'tal');
  await waitFor(() =>
    expect(within(form).getByRole('option', { name: /talita@example.com/ })).toBeTruthy(),
  );
  expect(within(form).queryByRole('option', { name: /lincoln@example.com/ })).toBeNull();
  await user.selectOptions(within(form).getByLabelText(/^usuário/i), 'u-2');
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
