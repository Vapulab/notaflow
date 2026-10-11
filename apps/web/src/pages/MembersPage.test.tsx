// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { meFor, renderWithMe } from '../test/renderWithMe';
import { stubApi } from '../test/stubApi';
import { MembersPage } from './MembersPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function invite(answer: object) {
  stubApi({
    '/api/accounts/acc/members': (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? answer : [],
  });
  renderWithMe(<MembersPage accountId="acc" />, meFor('user'));
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('E-mail'), 'contador@example.com');
  await user.type(screen.getByLabelText('Nome'), 'Contador');
  await user.click(screen.getByRole('button', { name: /Convidar/ }));
}

test('an invite says the e-mail went to the new member', async () => {
  await invite({ userId: 'u2', created: true, emailSent: true });
  expect(
    await screen.findByText(
      'Convite enviado para contador@example.com. A pessoa entra com um código enviado para esse e-mail.',
    ),
  ).toBeTruthy();
});

test('when the e-mail did not go, the owner learns how to tell the member', async () => {
  await invite({ userId: 'u2', created: true, emailSent: false });
  expect(
    await screen.findByText(
      `contador@example.com agora é membro da conta. O e-mail de convite não saiu agora e será reenviado automaticamente nos próximos minutos. A pessoa também pode entrar em ${window.location.host}/entrar com esse e-mail.`,
    ),
  ).toBeTruthy();
});
