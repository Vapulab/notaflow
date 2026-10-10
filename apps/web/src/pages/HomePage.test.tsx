// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { stubApi } from '../test/stubApi';
import { HomePage } from './HomePage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const me = (platformRole: 'admin' | 'user', role: 'owner' | 'member') => ({
  userId: 'u1',
  email: 'pessoa@example.com',
  name: 'Pessoa',
  platformRole,
  accounts: [{ id: 'acc', name: 'Vapulab', role, status: 'active' }],
});

test('the dashboard shows each option of the account as a card link', async () => {
  stubApi({ '/api/me': me('user', 'member') });
  render(<HomePage />);
  // A card carries a title and a line that says what the option is for.
  expect((await screen.findByRole('link', { name: /notas.*emitir/i })).getAttribute('href')).toBe(
    '#/a/acc/invoices',
  );
  expect(screen.getByRole('link', { name: /emitentes.*certificado/i })).toBeTruthy();
  expect(screen.getByRole('link', { name: /clientes.*tomadores/i })).toBeTruthy();
  expect(screen.queryByRole('link', { name: /membros/i })).toBeNull();
  expect(screen.queryByRole('link', { name: /painel do administrador/i })).toBeNull();
});

test('an owner gets Membros and the platform admin gets the admin panel card', async () => {
  stubApi({ '/api/me': me('admin', 'owner') });
  render(<HomePage />);
  expect(await screen.findByRole('link', { name: /membros.*convide/i })).toBeTruthy();
  expect(screen.getByRole('link', { name: /painel do administrador/i }).getAttribute('href')).toBe(
    '#/admin',
  );
});

test('the dashboard has a Nova nota card per account', async () => {
  stubApi({ '/api/me': me('user', 'member') });
  render(<HomePage />);
  const card = await screen.findByRole('link', { name: /nova nota.*sem modelo/i });
  expect(card.getAttribute('href')).toBe('#/a/acc/invoices/new');
});
