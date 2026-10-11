// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { stubApi } from '../test/stubApi';
import { EmittersPage } from './EmittersPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const emitter = {
  id: 'em1',
  cnpj: '12345678000195',
  companyName: 'EMPRESA TESTE LTDA',
  environment: 'producao',
  municipality: '4113700',
  dpsSeries: '900',
  certificate: { validTo: '2030-01-01T00:00:00Z', expiresSoon: false },
};
const me = (platformRole: 'admin' | 'user') => ({
  userId: 'u1',
  email: 'owner@example.com',
  name: 'Owner',
  platformRole,
  accounts: [{ id: 'acc', name: 'A', role: 'owner', status: 'active', onboardingStep: 'done' }],
});
const routes = (platformRole: 'admin' | 'user') => ({
  '/api/me': me(platformRole),
  '/api/accounts/acc/emitters/em1/sync': {
    environment: 'producao',
    lastNsu: 0,
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    running: false,
  },
  '/api/accounts/acc/emitters': [emitter],
});

test('an owner who is not a platform admin cannot switch the environment', async () => {
  stubApi(routes('user'));
  render(<EmittersPage accountId="acc" />);
  expect(await screen.findByRole('button', { name: /sincronizar agora/i })).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: /produção restrita|passar para produção/i }),
  ).toBeNull();
});

test('a platform admin sees the environment switch', async () => {
  stubApi(routes('admin'));
  render(<EmittersPage accountId="acc" />);
  expect(
    await screen.findByRole('button', { name: /voltar para produção restrita/i }),
  ).toBeTruthy();
});

test('an owner adds an emitter through the card, then the certificate', async () => {
  const calls = stubApi({
    ...routes('user'),
    '/api/accounts/acc/emitters/new/card': {
      draft: {
        cnpj: '11222333000181',
        legalName: 'SEGUNDA LTDA',
        tradeName: null,
        municipality: '4113700',
        uf: 'PR',
        cnae: null,
        simplesNacional: '2',
        source: 'brasilapi',
      },
      nameMismatch: false,
      municipalityName: 'Londrina',
    },
  });
  const user = userEvent.setup();
  render(<EmittersPage accountId="acc" />);
  await user.click(await screen.findByRole('button', { name: 'Adicionar emitente' }));
  await user.upload(
    screen.getByLabelText('Cartão CNPJ (PDF)'),
    new File(['%PDF'], 'c.pdf', { type: 'application/pdf' }),
  );
  await user.click(screen.getByRole('button', { name: 'Enviar cartão' }));
  expect(await screen.findByText('SEGUNDA LTDA')).toBeTruthy();
  expect(calls.some((c) => c.url === '/api/accounts/acc/emitters/new/card')).toBe(true);
  expect(screen.getByLabelText('Certificado A1 (.pfx)')).toBeTruthy();
});
