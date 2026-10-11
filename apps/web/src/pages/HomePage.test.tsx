// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { stubApi } from '../test/stubApi';
import { HomePage } from './HomePage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const me = (platformRole: 'admin' | 'user', role: 'owner' | 'member') => ({
  userId: 'u1',
  email: 'pessoa@example.com',
  name: 'Pessoa',
  platformRole,
  accounts: [{ id: 'acc', name: 'Vapulab', role, status: 'active', onboardingStep: 'done' }],
});

test('the dashboard shows each option of the account as a card link', async () => {
  stubApi({ '/api/me': me('user', 'member') });
  render(<HomePage />);
  // A card carries a title and a line that says what the option is for.
  expect((await screen.findByRole('link', { name: /notas.*emitir/i })).getAttribute('href')).toBe(
    '/app/acc/notas',
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
    '/admin',
  );
});

test('the dashboard has a Nova nota card per account', async () => {
  stubApi({ '/api/me': me('user', 'member') });
  render(<HomePage />);
  const card = await screen.findByRole('link', { name: /nova nota.*sem modelo/i });
  expect(card.getAttribute('href')).toBe('/app/acc/notas/nova');
});

const account = (id: string, step: string, role: 'owner' | 'member' = 'owner') => ({
  id,
  name: `Conta ${id}`,
  role,
  status: 'active',
  onboardingStep: step,
});
const meWith = (accounts: object[], platformRole: 'admin' | 'user' = 'user') => ({
  userId: 'u1',
  email: 'pessoa@example.com',
  name: 'Pessoa',
  platformRole,
  accounts,
});

test('a user without an account starts onboarding', async () => {
  window.history.replaceState(null, '', '/app');
  stubApi({ '/api/me': meWith([]) });
  render(<HomePage />);
  await waitFor(() => expect(window.location.pathname).toBe('/app/comecar'));
});

test('a platform admin without an account stays on the home page', async () => {
  window.history.replaceState(null, '', '/app');
  stubApi({ '/api/me': meWith([], 'admin') });
  render(<HomePage />);
  expect(await screen.findByText('Painel do administrador')).toBeTruthy();
  expect(window.location.pathname).toBe('/app');
});

test('the owner of one unfinished account goes back to its step', async () => {
  window.history.replaceState(null, '', '/app');
  stubApi({ '/api/me': meWith([account('acc', 'certificate')]) });
  render(<HomePage />);
  await waitFor(() => expect(window.location.pathname).toBe('/app/comecar/acc'));
});

test('with a finished account and an unfinished one, the home offers to continue', async () => {
  window.history.replaceState(null, '', '/app');
  stubApi({ '/api/me': meWith([account('a1', 'done'), account('a2', 'card')]) });
  render(<HomePage />);
  const link = await screen.findByRole('link', { name: /Continuar cadastro/ });
  expect(link.getAttribute('href')).toBe('/app/comecar/a2');
  expect(window.location.pathname).toBe('/app');
});

test('a member of an unfinished account waits for the owner', async () => {
  window.history.replaceState(null, '', '/app');
  stubApi({ '/api/me': meWith([account('acc', 'card', 'member')]) });
  render(<HomePage />);
  expect(await screen.findByText('O dono da conta ainda está concluindo o cadastro.')).toBeTruthy();
  expect(window.location.pathname).toBe('/app');
});
