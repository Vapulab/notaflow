// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '../api';
import * as authApi from '../auth/authApi';
import { MeProvider } from '../components/MeContext';
import { Layout } from '../components/Layout';
import { stubApi } from '../test/stubApi';
import { renderWithMe, meFor } from '../test/renderWithMe';
import { LoginPage, safeDestination } from './LoginPage';
import { ResetPage } from './ResetPage';
import { SignupPage } from './SignupPage';

vi.mock('../auth/authApi');
// The real widget loads Cloudflare's script; the fake answers a token at once.
vi.mock('../auth/Turnstile', () => ({
  Turnstile: (props: { siteKey: string; onToken: (token: string | null) => void }) => {
    useEffect(() => props.onToken(`token-for-${props.siteKey}`), [props]);
    return <div data-testid="turnstile" />;
  },
}));

const config = (overrides = {}) => ({
  '/api/public/config': {
    googleEnabled: false,
    turnstileSiteKey: null,
    signupOpen: true,
    ...overrides,
  },
});

beforeEach(() => {
  window.history.replaceState(null, '', '/entrar');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  Reflect.deleteProperty(window, 'PublicKeyCredential');
});

test('the login page offers code, then Google and passkey only when available, then password', async () => {
  stubApi(config({ googleEnabled: true }));
  vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
  render(<LoginPage />);
  await screen.findByRole('button', { name: 'Enviar código' });
  const buttons = within(screen.getByRole('main')).getAllByRole('button');
  expect(buttons.map((b) => b.textContent)).toEqual([
    'Enviar código',
    'Entrar com Google',
    'Entrar com senha',
    'Entrar com passkey',
  ]);
});

test('without Google or WebAuthn, those buttons do not show', async () => {
  stubApi(config());
  render(<LoginPage />);
  await screen.findByRole('button', { name: 'Enviar código' });
  expect(screen.queryByRole('button', { name: 'Entrar com Google' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Entrar com passkey' })).toBeNull();
});

test('a code login asks for the 6 digits and goes back where the user was', async () => {
  stubApi(config());
  window.history.replaceState(null, '', '/entrar?volta=%2Fapp%2Facc%2Fnotas');
  vi.mocked(authApi.sendCode).mockResolvedValue(undefined);
  vi.mocked(authApi.signInWithCode).mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<LoginPage />);
  await user.type(await screen.findByLabelText('E-mail'), 'pessoa@example.com');
  await user.click(screen.getByRole('button', { name: 'Enviar código' }));
  expect(authApi.sendCode).toHaveBeenCalledWith('pessoa@example.com', 'sign-in', null);
  const code = await screen.findByLabelText('Código de 6 dígitos');
  expect(code.getAttribute('autocomplete')).toBe('one-time-code');
  expect(code.getAttribute('inputmode')).toBe('numeric');
  await user.type(code, '123456');
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
  expect(authApi.signInWithCode).toHaveBeenCalledWith('pessoa@example.com', '123456');
  await waitFor(() => expect(window.location.pathname).toBe('/app/acc/notas'));
});

test.each([
  ['/app/acc/notas', '/app/acc/notas'],
  ['/admin', '/admin'],
  ['/app', '/app'],
  ['https://evil.example/app', '/app'],
  ['//evil.example/app', '/app'],
  ['/apple', '/app'],
  ['/entrar', '/app'],
  [null, '/app'],
])('safeDestination(%s) is %s', (volta, expected) => {
  expect(safeDestination(volta)).toBe(expected);
});

test.each([
  ['signup_closed', 403, 'O cadastro de novas empresas abre em breve.'],
  ['signup_limit', 429, 'Muitos cadastros a partir desta rede hoje. Tente amanhã.'],
  ['account_removed', 403, 'Esta conta foi removida. Fale com o suporte.'],
  ['INVALID_OTP', 400, 'Código incorreto. Confira e tente de novo.'],
  ['OTP_EXPIRED', 400, 'Este código expirou. Peça um novo.'],
  ['TOO_MANY_ATTEMPTS', 403, 'Tentativas demais com este código. Peça um novo.'],
  ['rate_limited', 429, 'Muitas tentativas. Espere um minuto e tente de novo.'],
])('the error %s shows in Portuguese', async (code, status, text) => {
  stubApi(config());
  vi.mocked(authApi.sendCode).mockRejectedValue(new ApiError(status, code));
  const user = userEvent.setup();
  render(<LoginPage />);
  await user.type(await screen.findByLabelText('E-mail'), 'pessoa@example.com');
  await user.click(screen.getByRole('button', { name: 'Enviar código' }));
  expect(await screen.findByText(text)).toBeTruthy();
});

test('a password login uses e-mail and password', async () => {
  stubApi(config());
  vi.mocked(authApi.signInWithPassword).mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<LoginPage />);
  await user.click(await screen.findByRole('button', { name: 'Entrar com senha' }));
  await user.type(screen.getByLabelText('E-mail'), 'pessoa@example.com');
  await user.type(screen.getByLabelText('Senha'), 'uma-senha-qualquer');
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
  expect(authApi.signInWithPassword).toHaveBeenCalledWith(
    'pessoa@example.com',
    'uma-senha-qualquer',
  );
  await waitFor(() => expect(window.location.pathname).toBe('/app'));
});

test('the Turnstile token goes with the code request', async () => {
  stubApi(config({ turnstileSiteKey: 'site' }));
  vi.mocked(authApi.sendCode).mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<LoginPage />);
  await screen.findByTestId('turnstile');
  await user.type(screen.getByLabelText('E-mail'), 'pessoa@example.com');
  await user.click(screen.getByRole('button', { name: 'Enviar código' }));
  expect(authApi.sendCode).toHaveBeenCalledWith('pessoa@example.com', 'sign-in', 'token-for-site');
});

test('signup closed says so and points to login', async () => {
  stubApi(config({ signupOpen: false }));
  render(<SignupPage />);
  expect(await screen.findByText('O cadastro de novas empresas abre em breve.')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/entrar');
  expect(screen.queryByLabelText('Senha')).toBeNull();
});

test('signup with a password, then the code from the e-mail', async () => {
  stubApi(config({ turnstileSiteKey: 'site' }));
  vi.mocked(authApi.signUpWithPassword).mockResolvedValue(undefined);
  vi.mocked(authApi.verifyEmail).mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<SignupPage />);
  await user.type(await screen.findByLabelText('Nome'), 'Pessoa');
  await user.type(screen.getByLabelText('E-mail'), 'pessoa@example.com');
  await user.type(screen.getByLabelText('Senha'), 'uma-senha-boa');
  expect(screen.getByText('Pelo menos 10 caracteres.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Criar conta' }));
  expect(authApi.signUpWithPassword).toHaveBeenCalledWith(
    'Pessoa',
    'pessoa@example.com',
    'uma-senha-boa',
    'token-for-site',
  );
  await user.type(await screen.findByLabelText('Código de 6 dígitos'), '654321');
  await user.click(screen.getByRole('button', { name: 'Confirmar e-mail' }));
  expect(authApi.verifyEmail).toHaveBeenCalledWith('pessoa@example.com', '654321');
  await waitFor(() => expect(window.location.pathname).toBe('/app'));
});

test('reset: e-mail, then code and new password, then a link to log in', async () => {
  stubApi(config());
  vi.mocked(authApi.requestReset).mockResolvedValue(undefined);
  vi.mocked(authApi.resetPassword).mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<ResetPage />);
  await user.type(await screen.findByLabelText('E-mail'), 'pessoa@example.com');
  await user.click(screen.getByRole('button', { name: 'Enviar código' }));
  expect(authApi.requestReset).toHaveBeenCalledWith('pessoa@example.com', null);
  await user.type(await screen.findByLabelText('Código de 6 dígitos'), '111222');
  await user.type(screen.getByLabelText('Nova senha'), 'nova-senha-boa');
  await user.click(screen.getByRole('button', { name: 'Salvar senha' }));
  expect(authApi.resetPassword).toHaveBeenCalledWith(
    'pessoa@example.com',
    '111222',
    'nova-senha-boa',
  );
  expect(await screen.findByText('Senha salva. Entre com ela.')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/entrar');
});

test('without a session the app sends the user to the login, remembering the page', async () => {
  window.history.replaceState(null, '', '/app/acc/notas');
  stubApi({ '/api/me': { error: 'unauthenticated' } });
  render(
    <MeProvider>
      <p>app</p>
    </MeProvider>,
  );
  await waitFor(() => expect(window.location.pathname).toBe('/entrar'));
  expect(window.location.search).toBe('?volta=%2Fapp%2Facc%2Fnotas');
});

test('Sair ends the Better Auth session and goes to the login', async () => {
  window.history.replaceState(null, '', '/app');
  vi.mocked(authApi.signOut).mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderWithMe(<Layout title="T">x</Layout>, meFor('user'));
  await user.click(screen.getByRole('button', { name: 'Sair' }));
  expect(authApi.signOut).toHaveBeenCalled();
  await waitFor(() => expect(window.location.pathname).toBe('/entrar'));
});

test('the other login methods are secondary buttons, so the main action stands out', async () => {
  stubApi(config({ googleEnabled: true }));
  vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
  render(<LoginPage />);
  await screen.findByRole('button', { name: 'Enviar código' });
  for (const name of ['Entrar com Google', 'Entrar com senha', 'Entrar com passkey']) {
    expect(screen.getByRole('button', { name }).className, name).not.toMatch(/\bbg-primary\b/);
  }
});

test('a passkey prompt the browser did not finish shows a plain message', async () => {
  stubApi(config());
  vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
  vi.mocked(authApi.signInWithPasskey).mockRejectedValue(
    new ApiError(400, 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY'),
  );
  const user = userEvent.setup();
  render(<LoginPage />);
  await user.click(await screen.findByRole('button', { name: 'Entrar com passkey' }));
  expect(
    await screen.findByText('O navegador não concluiu a passkey. Tente de novo.'),
  ).toBeTruthy();
});

test('a password login before the e-mail is confirmed points to the code login', async () => {
  stubApi(config());
  vi.mocked(authApi.signInWithPassword).mockRejectedValue(new ApiError(403, 'EMAIL_NOT_VERIFIED'));
  const user = userEvent.setup();
  render(<LoginPage />);
  await user.click(await screen.findByRole('button', { name: 'Entrar com senha' }));
  await user.type(screen.getByLabelText('E-mail'), 'pessoa@example.com');
  await user.type(screen.getByLabelText('Senha'), 'uma-senha-qualquer');
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
  expect(
    await screen.findByText(
      'Seu e-mail ainda não foi confirmado. Entre com um código por e-mail; ele confirma o e-mail.',
    ),
  ).toBeTruthy();
});

test.each([
  [
    'account_not_linked',
    'Este e-mail já tem conta no NotaFlow. Entre com um código por e-mail e depois vincule o Google em Minha conta.',
  ],
  ['signup_closed', 'O cadastro de novas empresas abre em breve.'],
  [
    'qualquer_outro',
    'Não foi possível entrar com o Google. Tente de novo ou use um código por e-mail.',
  ],
])('back from Google with error %s, the login page explains it', async (code, text) => {
  stubApi(config({ googleEnabled: true }));
  window.history.replaceState(null, '', `/entrar?error=${code}`);
  render(<LoginPage />);
  expect(await screen.findByText(text)).toBeTruthy();
});

test('Google comes back to the login page on an error', async () => {
  stubApi(config({ googleEnabled: true }));
  vi.mocked(authApi.signInWithGoogle).mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<LoginPage />);
  await user.click(await screen.findByRole('button', { name: 'Entrar com Google' }));
  expect(authApi.signInWithGoogle).toHaveBeenCalledWith('/app', '/entrar');
});
