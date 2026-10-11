// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { installDialogPolyfill } from '../test/dialog';
import { meFor, renderWithMe } from '../test/renderWithMe';
import { type StubCall, stubApi } from '../test/stubApi';
import { EmitterPage } from './EmitterPage';

beforeAll(installDialogPolyfill);
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
  certificate: null,
};
const fiscal = {
  simplesAnnex: 'III',
  simplesBand: 1,
  simplesPercent: 600,
  simplesRbt12Cents: 12_000_000,
  simplesRbt12At: new Date().toISOString(),
  rates: { domestic: 600, export: 305 },
  issRate: 200,
  ibscbsRegime: 'inside_das',
  ibscbsRegimeFrom: null,
};
const service = {
  id: 's1',
  emitterId: 'em1',
  name: 'Desenvolvimento',
  nationalTaxCode: '010101',
  description: 'Desenvolvimento de software',
  origin: 'manual',
  archived: false,
};
const base = '/api/accounts/acc';
const routes = (overrides: Record<string, unknown> = {}) => ({
  [`${base}/emitters`]: [emitter],
  [`${base}/emitters/em1/fiscal`]: fiscal,
  [`${base}/emitters/em1/services`]: [service],
  ...overrides,
});
const bodyOf = (calls: StubCall[], method: string) =>
  JSON.parse(String(calls.filter((c) => c.init?.method === method).at(-1)?.init?.body)) as unknown;

test('the owner sets the annex and the revenue; the band and both rates are shown', async () => {
  const calls = stubApi(
    routes({ [`${base}/simples-rates`]: { band: 2, domestic: 1575, export: 1084 } }),
  );
  renderWithMe(<EmitterPage accountId="acc" emitterId="em1" />, meFor('user'));
  const user = userEvent.setup();
  expect(
    await screen.findByText('Faixa 1 · alíquota efetiva 6,00% · exportação 3,05%'),
  ).toBeTruthy();
  await user.selectOptions(screen.getByLabelText('Anexo do Simples'), 'V');
  const revenue = screen.getByLabelText('Receita bruta dos últimos 12 meses (R$)');
  await user.clear(revenue);
  await user.type(revenue, '200.000,00');
  expect(
    await screen.findByText('Faixa 2 · alíquota efetiva 15,75% · exportação 10,84%'),
  ).toBeTruthy();
  expect(calls.some((c) => c.url === `${base}/simples-rates?annex=V&rbt12Cents=20000000`)).toBe(
    true,
  );
  const iss = screen.getByLabelText('Alíquota de ISS (%)');
  await user.clear(iss);
  await user.type(iss, '3,5');
  await user.selectOptions(screen.getByLabelText('Regime do IBS/CBS'), 'regular');
  await user.type(screen.getByLabelText('Desde'), '2027-01-01');
  await user.click(screen.getByRole('button', { name: 'Salvar configuração' }));
  await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT')).toBe(true));
  expect(bodyOf(calls, 'PUT')).toEqual({
    simplesAnnex: 'V',
    simplesRbt12Cents: 20_000_000,
    issRate: 350,
    ibscbsRegime: 'regular',
    ibscbsRegimeFrom: '2027-01-01',
  });
  expect(await screen.findByText('Configuração salva.')).toBeTruthy();
});

test('a member reads the configuration and the services but changes nothing', async () => {
  stubApi(routes());
  renderWithMe(<EmitterPage accountId="acc" emitterId="em1" />, meFor('user', 'member'));
  expect(
    (await screen.findByLabelText('Receita bruta dos últimos 12 meses (R$)')).matches(':disabled'),
  ).toBe(true);
  expect(
    (screen.getByRole('button', { name: 'Salvar configuração' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    screen.getByText('Só o dono da conta altera a configuração fiscal e os serviços.'),
  ).toBeTruthy();
  expect(await screen.findByText('Desenvolvimento')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Novo serviço' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((screen.getByRole('button', { name: 'Editar' }) as HTMLButtonElement).disabled).toBe(true);
});

test('the services list shows the code with dots and can show archived ones', async () => {
  const calls = stubApi(routes());
  renderWithMe(<EmitterPage accountId="acc" emitterId="em1" />, meFor('user'));
  const user = userEvent.setup();
  const row = (await screen.findByText('Desenvolvimento')).closest('tr');
  expect(row && within(row).getByText('01.01.01')).toBeTruthy();
  await user.click(screen.getByLabelText('Mostrar arquivados'));
  await waitFor(() =>
    expect(calls.some((c) => c.url.endsWith('/emitters/em1/services?archived=1'))).toBe(true),
  );
});

test('a new service comes from the national code search', async () => {
  const calls = stubApi(
    routes({
      [`${base}/service-codes`]: [
        { code: '010701', description: 'Suporte técnico em informática.' },
      ],
    }),
  );
  renderWithMe(<EmitterPage accountId="acc" emitterId="em1" />, meFor('user'));
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Novo serviço' }));
  const dialog = screen.getByRole('dialog');
  await user.type(within(dialog).getByRole('combobox', { name: 'Código nacional' }), 'suporte');
  await user.click(
    await within(dialog).findByRole('option', {
      name: '01.07.01 – Suporte técnico em informática.',
    }),
  );
  expect((within(dialog).getByLabelText('Descrição') as HTMLTextAreaElement).value).toBe(
    'Suporte técnico em informática.',
  );
  await user.type(within(dialog).getByLabelText('Nome'), 'Suporte');
  await user.click(within(dialog).getByRole('button', { name: 'Mais opções' }));
  await user.type(within(dialog).getByLabelText('NBS'), '115080000');
  await user.type(within(dialog).getByLabelText('CST do PIS/COFINS'), '00');
  await user.click(within(dialog).getByRole('button', { name: 'Salvar serviço' }));
  await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST')).toBe(true));
  expect(bodyOf(calls, 'POST')).toEqual({
    name: 'Suporte',
    nationalTaxCode: '010701',
    description: 'Suporte técnico em informática.',
    nbsCode: '115080000',
    pisCofinsCst: '00',
  });
});

test('editing keeps the service fields, and archiving sends archived', async () => {
  const calls = stubApi(routes({ [`${base}/services/s1`]: service }));
  renderWithMe(<EmitterPage accountId="acc" emitterId="em1" />, meFor('user'));
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Arquivar' }));
  await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT')).toBe(true));
  expect(bodyOf(calls, 'PUT')).toEqual({
    name: 'Desenvolvimento',
    nationalTaxCode: '010101',
    description: 'Desenvolvimento de software',
    archived: true,
  });
});

test('while the user is still loading, the owner-only notice does not show', async () => {
  stubApi(routes());
  renderWithMe(<EmitterPage accountId="acc" emitterId="em1" />, null);
  await screen.findByLabelText('Receita bruta dos últimos 12 meses (R$)');
  expect(
    screen.queryByText('Só o dono da conta altera a configuração fiscal e os serviços.'),
  ).toBeNull();
});

test('the missing-configuration warning goes away once the owner saves', async () => {
  stubApi(
    routes({
      [`${base}/emitters/em1/fiscal`]: {
        ...fiscal,
        simplesAnnex: null,
        simplesBand: null,
        simplesPercent: null,
        simplesRbt12Cents: null,
        simplesRbt12At: null,
        rates: null,
        issRate: null,
      },
      [`${base}/simples-rates`]: { band: 1, domestic: 600, export: 305 },
    }),
  );
  renderWithMe(<EmitterPage accountId="acc" emitterId="em1" />, meFor('user'));
  const user = userEvent.setup();
  expect(await screen.findByText(/Sem esta configuração/)).toBeTruthy();
  await user.type(screen.getByLabelText('Receita bruta dos últimos 12 meses (R$)'), '120.000,00');
  await user.type(screen.getByLabelText('Alíquota de ISS (%)'), '2,00');
  await user.click(screen.getByRole('button', { name: 'Salvar configuração' }));
  expect(await screen.findByText('Configuração salva.')).toBeTruthy();
  expect(screen.queryByText(/Sem esta configuração/)).toBeNull();
});

test("before typing, the code field suggests the codes of the company's CNAEs, marked as a suggestion", async () => {
  stubApi(
    routes({
      [`${base}/emitters/em1/service-codes/suggested`]: {
        cnaes: ['6201501'],
        codes: [
          { code: '010101', description: 'Análise e desenvolvimento de sistemas.' },
          { code: '010201', description: 'Programação.' },
        ],
      },
    }),
  );
  renderWithMe(<EmitterPage accountId="acc" emitterId="em1" />, meFor('user'));
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Novo serviço' }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('combobox', { name: 'Código nacional' }));
  expect(
    await within(dialog).findByText('Sugeridos pelas atividades (CNAE) da empresa'),
  ).toBeTruthy();
  expect(
    within(dialog).getByRole('option', {
      name: '01.01.01 – Análise e desenvolvimento de sistemas.',
    }),
  ).toBeTruthy();
  expect(within(dialog).getByRole('option', { name: '01.02.01 – Programação.' })).toBeTruthy();
});

test('a code suggested before any typing is the code the new service saves', async () => {
  const calls = stubApi(
    routes({
      [`${base}/emitters/em1/service-codes/suggested`]: {
        cnaes: ['6201501'],
        codes: [{ code: '010201', description: 'Programação.' }],
      },
    }),
  );
  renderWithMe(<EmitterPage accountId="acc" emitterId="em1" />, meFor('user'));
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Novo serviço' }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('combobox', { name: 'Código nacional' }));
  await user.click(await within(dialog).findByRole('option', { name: '01.02.01 – Programação.' }));
  await user.type(within(dialog).getByLabelText('Nome'), 'Programação');
  await user.click(within(dialog).getByRole('button', { name: 'Salvar serviço' }));
  await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST')).toBe(true));
  const post = calls.find((c) => c.init?.method === 'POST');
  expect(JSON.parse(String(post?.init?.body))).toMatchObject({ nationalTaxCode: '010201' });
});
