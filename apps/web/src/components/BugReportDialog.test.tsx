// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { installDialogPolyfill } from '../test/dialog';
import { meFor, renderWithMe } from '../test/renderWithMe';
import { stubApi } from '../test/stubApi';
import { ERROR_TEXT, Layout } from './Layout';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('the header offers Reportar bug only inside an account', () => {
  renderWithMe(<Layout title="Painel">x</Layout>, meFor('user'));
  expect(screen.queryByRole('button', { name: 'Reportar bug' })).toBeNull();
  cleanup();
  renderWithMe(
    <Layout title="Notas" accountId="acc">
      x
    </Layout>,
    meFor('user'),
  );
  expect(screen.getByRole('button', { name: 'Reportar bug' })).toBeTruthy();
});

test('a bug report sends the title, the text, and the current path, then thanks the person', async () => {
  installDialogPolyfill();
  window.history.replaceState(null, '', '/app/acc/notas?pagina=2');
  const calls = stubApi({ '/api/accounts/acc/bug-reports': { id: 'b1' } });
  renderWithMe(
    <Layout title="Notas" accountId="acc">
      x
    </Layout>,
    meFor('user'),
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Reportar bug' }));
  const send = screen.getByRole('button', { name: 'Enviar' });
  expect(send.hasAttribute('disabled')).toBe(true);
  await user.type(screen.getByLabelText('Título'), 'Botão não responde');
  await user.type(screen.getByLabelText('O que aconteceu?'), 'Cliquei em Emitir.');
  expect(screen.getByText('18/4000')).toBeTruthy();
  await user.click(send);
  expect(
    await screen.findByText(
      'Obrigado! Recebemos o seu relato e vamos responder pelo e-mail da conta.',
    ),
  ).toBeTruthy();
  const post = calls.find((call) => call.url.endsWith('/bug-reports'));
  expect(post?.init?.method).toBe('POST');
  expect(JSON.parse(String(post?.init?.body))).toEqual({
    title: 'Botão não responde',
    description: 'Cliquei em Emitir.',
    pagePath: '/app/acc/notas',
  });
});

test('a refused report shows the error text', async () => {
  installDialogPolyfill();
  stubApi({ '/api/accounts/acc/bug-reports': { error: 'too_many_bug_reports' } });
  renderWithMe(
    <Layout title="Notas" accountId="acc">
      x
    </Layout>,
    meFor('user'),
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Reportar bug' }));
  await user.type(screen.getByLabelText('Título'), 'Erro');
  await user.type(screen.getByLabelText('O que aconteceu?'), 'Deu erro.');
  await user.click(screen.getByRole('button', { name: 'Enviar' }));
  expect(await screen.findByText(ERROR_TEXT.too_many_bug_reports ?? '')).toBeTruthy();
});
