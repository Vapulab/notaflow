// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Me, OnboardingStep } from '../api';
import { renderWithMe } from '../test/renderWithMe';
import { stubApi } from '../test/stubApi';
import { OnboardingPage } from './onboarding/OnboardingPage';

const draft = {
  cnpj: '12345678000195',
  legalName: 'EMPRESA TESTE LTDA',
  tradeName: null,
  municipality: '4113700',
  uf: 'PR',
  cnae: '6201501',
  simplesNacional: '3',
  source: 'brasilapi',
};
const base = '/api/accounts/acc';
const meWith = (step: OnboardingStep | null): Me => ({
  userId: 'u1',
  email: 'pessoa@example.com',
  name: 'Pessoa',
  platformRole: 'user',
  accounts:
    step === null
      ? []
      : [
          {
            id: 'acc',
            name: 'Minha Empresa',
            role: 'owner',
            status: 'active',
            onboardingStep: step,
          },
        ],
});
const state = (step: string, withDraft = false) => ({
  [`${base}/onboarding`]: {
    step,
    draft: withDraft ? draft : null,
    municipalityName: withDraft ? 'Londrina' : null,
  },
});

beforeEach(() => window.history.replaceState(null, '', '/app/comecar/acc'));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('the timeline shows the seven steps and where the account is', async () => {
  stubApi(state('certificate', true));
  renderWithMe(<OnboardingPage accountId="acc" />, meWith('certificate'));
  const items = within(
    await screen.findByRole('list', { name: 'Etapas do cadastro' }),
  ).getAllByRole('listitem');
  expect(items.map((i) => i.querySelector('h3')?.textContent)).toEqual([
    'Criar conta',
    'Nome da empresa',
    'Cartão CNPJ',
    'Certificado digital',
    'Configuração fiscal',
    'Sincronização',
    'Tour',
  ]);
  expect(items.map((i) => within(i).getByTestId('state').textContent)).toEqual([
    'feito',
    'feito',
    'feito',
    'atual',
    'a fazer',
    'a fazer',
    'a fazer',
  ]);
  expect(items[3]?.getAttribute('aria-current')).toBe('step');
});

test('a user without an account names the company, then goes to the card step', async () => {
  window.history.replaceState(null, '', '/app/comecar');
  const calls = stubApi({ '/api/onboarding/account': { accountId: 'acc' }, ...state('card') });
  const user = userEvent.setup();
  renderWithMe(<OnboardingPage />, meWith(null));
  await user.type(await screen.findByLabelText('Nome da empresa'), 'Minha Empresa');
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  const post = calls.find((c) => c.url === '/api/onboarding/account');
  expect(JSON.parse(String(post?.init?.body))).toEqual({ name: 'Minha Empresa' });
  await waitFor(() => expect(window.location.pathname).toBe('/app/comecar/acc'));
});

test('the card is sent as a PDF, and the data come back to be checked', async () => {
  const calls = stubApi({
    ...state('card'),
    [`${base}/onboarding/card`]: { draft, nameMismatch: false, municipalityName: 'Londrina' },
  });
  const user = userEvent.setup();
  renderWithMe(<OnboardingPage accountId="acc" />, meWith('card'));
  const input = await screen.findByLabelText('Cartão CNPJ (PDF)');
  expect(input.getAttribute('accept')).toBe('application/pdf');
  await user.upload(input, new File(['%PDF-1.7'], 'cartao.pdf', { type: 'application/pdf' }));
  await user.click(screen.getByRole('button', { name: 'Enviar cartão' }));
  const check = await screen.findByRole('region', { name: 'Confira os dados' });
  const sent = calls.find((c) => c.url === `${base}/onboarding/card`);
  expect(JSON.parse(String(sent?.init?.body))).toMatchObject({ fileName: 'cartao.pdf' });
  expect(within(check).getByText('EMPRESA TESTE LTDA')).toBeTruthy();
  expect(within(check).getByText('12.345.678/0001-95')).toBeTruthy();
  expect(within(check).getByText('Londrina - PR')).toBeTruthy();
  expect(within(check).getByText('Optante (ME ou EPP)')).toBeTruthy();
  expect(screen.getByLabelText('Inscrição municipal (opcional)')).toBeTruthy();
});

test('a card that cannot be read offers to type the CNPJ', async () => {
  const calls = stubApi({
    ...state('card'),
    [`${base}/onboarding/card`]: { error: 'card_unreadable' },
    [`${base}/onboarding/cnpj`]: { draft, nameMismatch: false, municipalityName: 'Londrina' },
  });
  const user = userEvent.setup();
  renderWithMe(<OnboardingPage accountId="acc" />, meWith('card'));
  await user.upload(
    await screen.findByLabelText('Cartão CNPJ (PDF)'),
    new File(['x'], 'scan.pdf', { type: 'application/pdf' }),
  );
  await user.click(screen.getByRole('button', { name: 'Enviar cartão' }));
  await user.click(await screen.findByRole('button', { name: 'Digitar o CNPJ' }));
  await user.type(screen.getByLabelText('CNPJ'), '12.345.678/0001-95');
  await user.click(screen.getByRole('button', { name: 'Consultar CNPJ' }));
  const sent = calls.find((c) => c.url === `${base}/onboarding/cnpj`);
  expect(JSON.parse(String(sent?.init?.body))).toEqual({ cnpj: '12.345.678/0001-95' });
  expect(await screen.findByRole('region', { name: 'Confira os dados' })).toBeTruthy();
});

test.each([
  [
    'cnpj_not_active',
    { status: 'BAIXADA' },
    'Este CNPJ não está ativo na Receita (situação: BAIXADA).',
  ],
  ['cnpj_lookup_unavailable', {}, 'A consulta do CNPJ não respondeu. Tente de novo em instantes.'],
])('the card error %s is explained', async (error, extra, text) => {
  stubApi({ ...state('card'), [`${base}/onboarding/card`]: { error, ...extra } });
  const user = userEvent.setup();
  renderWithMe(<OnboardingPage accountId="acc" />, meWith('card'));
  await user.upload(
    await screen.findByLabelText('Cartão CNPJ (PDF)'),
    new File(['%PDF'], 'c.pdf', { type: 'application/pdf' }),
  );
  await user.click(screen.getByRole('button', { name: 'Enviar cartão' }));
  expect(await screen.findByText(text)).toBeTruthy();
});

test('the certificate step: password not remembered, advanced options folded, mismatch explained', async () => {
  const calls = stubApi({
    ...state('certificate', true),
    [`${base}/onboarding/certificate`]: { error: 'certificate_cnpj_mismatch' },
  });
  const user = userEvent.setup();
  renderWithMe(<OnboardingPage accountId="acc" />, meWith('certificate'));
  const password = await screen.findByLabelText('Senha do certificado');
  expect(password.getAttribute('autocomplete')).toBe('off');
  const advanced = screen.getByText('Opções avançadas').closest('details');
  expect(advanced?.open).toBe(false);
  expect(within(advanced as HTMLElement).getByLabelText('Série da DPS')).toHaveProperty(
    'value',
    '900',
  );
  await user.upload(
    screen.getByLabelText('Certificado A1 (.pfx)'),
    new File(['pfx'], 'empresa.pfx', { type: 'application/x-pkcs12' }),
  );
  await user.type(password, 'segredo');
  await user.click(screen.getByRole('button', { name: 'Enviar certificado' }));
  expect(calls.some((c) => c.url === `${base}/onboarding/certificate`)).toBe(true);
  expect(
    await screen.findByText(
      'Este certificado é de outro CNPJ. Envie o certificado da empresa do cartão.',
    ),
  ).toBeTruthy();
});

test('"Trocar cartão" goes back to the card step', async () => {
  const calls = stubApi({
    ...state('certificate', true),
    [`${base}/onboarding/back-to-card`]: { step: 'card' },
  });
  const user = userEvent.setup();
  renderWithMe(<OnboardingPage accountId="acc" />, meWith('certificate'));
  await user.click(await screen.findByRole('button', { name: 'Trocar cartão' }));
  expect(calls.some((c) => c.url === `${base}/onboarding/back-to-card`)).toBe(true);
  expect(await screen.findByLabelText('Cartão CNPJ (PDF)')).toBeTruthy();
});

test('"Fazer depois" skips the fiscal configuration', async () => {
  const calls = stubApi({
    ...state('fiscal', true),
    [`${base}/emitters`]: [
      {
        id: 'em1',
        cnpj: '12345678000195',
        companyName: 'EMPRESA',
        environment: 'producao',
        municipality: '4113700',
        dpsSeries: '900',
        certificate: null,
      },
    ],
    [`${base}/emitters/em1/fiscal`]: {
      simplesAnnex: null,
      simplesBand: null,
      simplesPercent: null,
      issRate: null,
      ibscbsRegime: 'inside_das',
      ibscbsRegimeFrom: null,
      bands: { III: [600], V: [1550] },
    },
    [`${base}/onboarding/fiscal-done`]: { step: 'sync' },
    [`${base}/invoices`]: { items: [], total: 0 },
  });
  const user = userEvent.setup();
  renderWithMe(<OnboardingPage accountId="acc" />, meWith('fiscal'));
  await user.click(await screen.findByRole('button', { name: 'Fazer depois' }));
  expect(calls.some((c) => c.url === `${base}/onboarding/fiscal-done`)).toBe(true);
  expect(await screen.findByText(/notas importadas/)).toBeTruthy();
});

test('the sync step counts imported invoices and lets the user go to the dashboard', async () => {
  const calls = stubApi({
    ...state('sync', true),
    [`${base}/invoices`]: { items: [], total: 12 },
    [`${base}/onboarding/finish`]: { step: 'done' },
  });
  const user = userEvent.setup();
  renderWithMe(<OnboardingPage accountId="acc" />, meWith('sync'));
  expect(await screen.findByText('12 notas importadas até agora')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Ir para o painel' }));
  expect(calls.some((c) => c.url === `${base}/onboarding/finish`)).toBe(true);
  await waitFor(() => expect(window.location.pathname).toBe('/app'));
});
