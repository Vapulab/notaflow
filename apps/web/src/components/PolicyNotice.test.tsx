// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { meFor, renderWithMe } from '../test/renderWithMe';
import { stubApi } from '../test/stubApi';
import { PolicyNotice } from './PolicyNotice';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const notice = {
  id: 'n1',
  date: '2026-11-01',
  text: 'Incluímos um fornecedor.',
  href: '/privacidade',
};

test('a policy update shows once, links to the text, and "Entendi" records it and hides it', async () => {
  const calls = stubApi({ '/api/me/policy-notice': {} });
  renderWithMe(<PolicyNotice />, { ...meFor('user'), policyNotice: notice });
  expect(screen.getByText(/Incluímos um fornecedor/)).toBeTruthy();
  expect(screen.getByRole('link', { name: /Ler a política/ }).getAttribute('href')).toBe(
    '/privacidade',
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Entendi' }));
  expect(screen.queryByText(/Incluímos um fornecedor/)).toBeNull();
  const sent = calls.find((c) => c.url === '/api/me/policy-notice');
  expect(JSON.parse(String(sent?.init?.body))).toEqual({ id: 'n1' });
});

test('without a notice nothing shows', () => {
  const { container } = renderWithMe(<PolicyNotice />, { ...meFor('user'), policyNotice: null });
  expect(container.textContent).toBe('');
});

test('after "Entendi", the next screen does not show the notice again', async () => {
  stubApi({ '/api/me/policy-notice': {} });
  const me = { ...meFor('user'), policyNotice: { ...notice, id: 'n2' } };
  const first = renderWithMe(<PolicyNotice />, me);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Entendi' }));
  first.unmount();
  const next = renderWithMe(<PolicyNotice />, me);
  expect(next.container.textContent).toBe('');
});
