// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as authApi from '../auth/authApi';
import { stubApi } from '../test/stubApi';
import { meFor, renderWithMe } from '../test/renderWithMe';
import { ProfilePage } from './ProfilePage';

vi.mock('../auth/authApi');
vi.mock('../auth/Turnstile', () => ({ Turnstile: () => null }));

const NOW = '2026-10-10T12:00:00.000Z';

function account(
  overrides: Partial<{ accounts: authApi.LinkedAccount[]; passkeys: authApi.PasskeyItem[] }> = {},
) {
  vi.mocked(authApi.listAccounts).mockResolvedValue(
    overrides.accounts ?? [{ id: 'acc-cred', providerId: 'credential' }],
  );
  vi.mocked(authApi.listPasskeys).mockResolvedValue(
    overrides.passkeys ?? [{ id: 'pk1', name: 'Notebook', createdAt: NOW }],
  );
  vi.mocked(authApi.listSessions).mockResolvedValue([
    {
      id: 's1',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0',
      ipAddress: '203.0.113.7',
      updatedAt: NOW,
      current: true,
    },
    {
      id: 's2',
      userAgent: 'Mozilla/5.0 (iPhone) Safari/605.1',
      ipAddress: '198.51.100.9',
      updatedAt: NOW,
      current: false,
    },
  ]);
}

beforeEach(() => {
  window.history.replaceState(null, '', '/app/conta');
  stubApi({
    '/api/public/config': { googleEnabled: true, turnstileSiteKey: null, signupOpen: true },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

test('the name is shown and saved', async () => {
  account();
  vi.mocked(authApi.updateName).mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderWithMe(<ProfilePage />, meFor('user'));
  const name = await screen.findByLabelText('Nome');
  expect((name as HTMLInputElement).value).toBe('Pessoa');
  await user.clear(name);
  await user.type(name, 'Pessoa Nova');
  await user.click(screen.getByRole('button', { name: 'Salvar nome' }));
  expect(authApi.updateName).toHaveBeenCalledWith('Pessoa Nova');
  expect(await screen.findByText('Nome salvo.')).toBeTruthy();
});

test('a user with a password changes it with a code, then logs in again', async () => {
  account();
  vi.mocked(authApi.requestReset).mockResolvedValue(undefined);
  vi.mocked(authApi.resetPassword).mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderWithMe(<ProfilePage />, meFor('user'));
  await user.click(await screen.findByRole('button', { name: 'Alterar senha' }));
  expect(authApi.requestReset).toHaveBeenCalledWith('pessoa@example.com', null);
  await user.type(await screen.findByLabelText('Código de 6 dígitos'), '123456');
  await user.type(screen.getByLabelText('Nova senha'), 'nova-senha-boa');
  await user.click(screen.getByRole('button', { name: 'Salvar senha' }));
  expect(authApi.resetPassword).toHaveBeenCalledWith(
    'pessoa@example.com',
    '123456',
    'nova-senha-boa',
  );
  await waitFor(() => expect(window.location.pathname).toBe('/entrar'));
});

test('a user without a password sees Criar senha', async () => {
  account({ accounts: [] });
  renderWithMe(<ProfilePage />, meFor('user'));
  expect(await screen.findByRole('button', { name: 'Criar senha' })).toBeTruthy();
});

test('passkeys are listed, added, and removed', async () => {
  account();
  vi.mocked(authApi.addPasskey).mockResolvedValue(undefined);
  vi.mocked(authApi.deletePasskey).mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderWithMe(<ProfilePage />, meFor('user'));
  const section = (await screen.findByRole('heading', { name: 'Passkeys' })).closest('section');
  if (!section) throw new Error('no passkey section');
  expect(await within(section).findByText('Notebook')).toBeTruthy();
  await user.click(within(section).getByRole('button', { name: 'Adicionar passkey' }));
  expect(authApi.addPasskey).toHaveBeenCalled();
  await user.click(within(section).getByRole('button', { name: 'Remover Notebook' }));
  expect(authApi.deletePasskey).toHaveBeenCalledWith('pk1');
});

test('Google can be linked; unlinking shows only when another sign-in account remains', async () => {
  account({ accounts: [{ id: 'g1', providerId: 'google' }] });
  vi.mocked(authApi.linkGoogle).mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderWithMe(<ProfilePage />, meFor('user'));
  expect(await screen.findByText('Google vinculado.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Desvincular Google' })).toBeNull();
  cleanup();

  account({ accounts: [{ id: 'acc-cred', providerId: 'credential' }] });
  renderWithMe(<ProfilePage />, meFor('user'));
  await user.click(await screen.findByRole('button', { name: 'Vincular Google' }));
  expect(authApi.linkGoogle).toHaveBeenCalled();
  cleanup();

  account({
    accounts: [
      { id: 'acc-cred', providerId: 'credential' },
      { id: 'g1', providerId: 'google' },
    ],
  });
  vi.mocked(authApi.unlinkAccount).mockResolvedValue(undefined);
  renderWithMe(<ProfilePage />, meFor('user'));
  await user.click(await screen.findByRole('button', { name: 'Desvincular Google' }));
  expect(authApi.unlinkAccount).toHaveBeenCalledWith('g1');
});

test('sessions show browser, IP, and the current one; ending all goes to the login', async () => {
  account();
  vi.mocked(authApi.revokeSessions).mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderWithMe(<ProfilePage />, meFor('user'));
  const section = (await screen.findByRole('heading', { name: 'Sessões ativas' })).closest(
    'section',
  );
  if (!section) throw new Error('no session section');
  expect(await within(section).findByText(/Chrome no Windows/)).toBeTruthy();
  expect(within(section).getByText(/Safari no iPhone/)).toBeTruthy();
  expect(within(section).getByText('203.0.113.7')).toBeTruthy();
  expect(within(section).getByText('Esta sessão')).toBeTruthy();
  await user.click(within(section).getByRole('button', { name: 'Sair de todos os dispositivos' }));
  expect(authApi.revokeSessions).toHaveBeenCalled();
  await waitFor(() => expect(window.location.pathname).toBe('/entrar'));
});
