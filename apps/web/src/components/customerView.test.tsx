// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { MembersPage } from '../pages/MembersPage';
import { meFor, renderWithMe } from '../test/renderWithMe';
import { stubApi } from '../test/stubApi';
import { EnvironmentBadge } from './EnvironmentBadge';
import { Layout } from './Layout';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

test('a customer never sees the production badge; a test invoice is still marked', () => {
  const { container } = renderWithMe(<EnvironmentBadge environment="producao" />, meFor('user'));
  expect(container.textContent).toBe('');
  renderWithMe(<EnvironmentBadge environment="producao_restrita" />, meFor('user'));
  expect(screen.getByText(/PRODUÇÃO RESTRITA/)).toBeTruthy();
});

test('the platform admin sees the production badge', () => {
  renderWithMe(<EnvironmentBadge environment="producao" />, meFor('admin'));
  expect(screen.getByText('PRODUÇÃO')).toBeTruthy();
});

test('without a known user the production badge stays hidden', () => {
  const { container } = render(<EnvironmentBadge environment="producao" />);
  expect(container.textContent).toBe('');
});

test('Membros shows in the top bar only to an owner of the account', () => {
  renderWithMe(
    <Layout title="Notas" accountId="acc">
      <p>x</p>
    </Layout>,
    meFor('user', 'member'),
  );
  expect(screen.queryByRole('link', { name: 'Membros' })).toBeNull();
  cleanup();
  renderWithMe(
    <Layout title="Notas" accountId="acc">
      <p>x</p>
    </Layout>,
    meFor('user', 'owner'),
  );
  expect(screen.getByRole('link', { name: 'Membros' })).toBeTruthy();
});

test('a member who opens Membros sees why, and no list or invite form', async () => {
  stubApi({ '/api/accounts/acc/members': { error: 'owner_only' } });
  renderWithMe(<MembersPage accountId="acc" />, meFor('user', 'member'));
  expect(await screen.findByText(/só o dono da conta gerencia os membros/i)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Convidar' })).toBeNull();
  expect(screen.queryByLabelText('E-mail')).toBeNull();
});
