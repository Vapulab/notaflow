// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { meFor, renderWithMe } from '../test/renderWithMe';
import { stubApi } from '../test/stubApi';
import { PasswordNotice } from './PasswordNotice';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('without an erased password nothing shows', () => {
  const { container } = renderWithMe(<PasswordNotice />, {
    ...meFor('user'),
    passwordRemoved: false,
  });
  expect(container.textContent).toBe('');
});

test('an erased password shows the reason and a link to create one; "Entendi" records it for every screen', async () => {
  const calls = stubApi({ '/api/me/password-notice': {} });
  const me = { ...meFor('user'), passwordRemoved: true };
  const first = renderWithMe(<PasswordNotice />, me);
  expect(screen.getByText(/a senha do cadastro foi apagada/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Criar uma senha nova' }).getAttribute('href')).toBe(
    '/app/conta',
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Entendi' }));
  expect(screen.queryByText(/a senha do cadastro foi apagada/)).toBeNull();
  expect(calls.some((c) => c.url === '/api/me/password-notice')).toBe(true);
  first.unmount();
  const next = renderWithMe(<PasswordNotice />, me);
  expect(next.container.textContent).toBe('');
});
