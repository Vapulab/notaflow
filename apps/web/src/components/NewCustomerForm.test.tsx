// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { Customer, Emitter } from '../api';
import { type StubCall, stubApi } from '../test/stubApi';
import { NewCustomerForm } from './NewCustomerForm';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const emitter = (id: string, companyName: string): Emitter => ({
  id,
  cnpj: '12345678000195',
  companyName,
  environment: 'producao',
  municipality: '4113700',
  dpsSeries: '900',
  autoEmailCustomer: false,
  certificate: null,
});
const created: Customer = {
  id: 'c9',
  emitterId: 'em1',
  documentType: 'CNPJ',
  document: '11222333000181',
  name: 'Cliente Teste Ltda',
  email: null,
  phone: null,
  municipalRegistration: null,
  address: null,
  origin: 'manual',
  archived: false,
};
const cep = {
  '/api/accounts/acc/cep/86010000': {
    zip: '86010000',
    street: 'Rua Teste',
    district: 'Centro',
    municipality: { code: '4113700', name: 'Londrina', uf: 'PR' },
  },
};
const posted = (calls: StubCall[]) =>
  JSON.parse(String(calls.find((c) => c.init?.method === 'POST')?.init?.body)) as unknown;

function renderForm(props: Partial<Parameters<typeof NewCustomerForm>[0]> = {}) {
  const onCreated = vi.fn();
  render(
    <NewCustomerForm
      accountId="acc"
      emitters={[emitter('em1', 'EMPRESA UM')]}
      onCreated={onCreated}
      onCancel={() => {}}
      {...props}
    />,
  );
  return { onCreated, user: userEvent.setup() };
}

test('a Brazil customer: document digits only, the address from the CEP', async () => {
  const calls = stubApi({ ...cep, '/api/accounts/acc/customers': created });
  const { onCreated, user } = renderForm();
  await user.click(screen.getByRole('radio', { name: 'Cliente no Brasil' }));
  await user.type(screen.getByLabelText('CNPJ'), '11.222.333/0001-81');
  await user.type(screen.getByLabelText('Nome ou razão social'), 'Cliente Teste Ltda');
  await user.type(screen.getByLabelText('CEP'), '86010000');
  await user.tab();
  await waitFor(() =>
    expect((screen.getByLabelText('Logradouro') as HTMLInputElement).value).toBe('Rua Teste'),
  );
  await user.type(screen.getByLabelText('Número'), '1');
  await user.click(screen.getByRole('button', { name: 'Cadastrar cliente' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
  expect(posted(calls)).toEqual({
    emitterId: 'em1',
    documentType: 'CNPJ',
    document: '11222333000181',
    name: 'Cliente Teste Ltda',
    address: {
      kind: 'domestic',
      municipality: '4113700',
      zip: '86010000',
      street: 'Rua Teste',
      number: '1',
      district: 'Centro',
    },
  });
});

test('a CPF is chosen in the document select', async () => {
  const calls = stubApi({ ...cep, '/api/accounts/acc/customers': created });
  const { user } = renderForm();
  await user.click(screen.getByRole('radio', { name: 'Cliente no Brasil' }));
  await user.selectOptions(screen.getByLabelText('Tipo de documento'), 'CPF');
  await user.type(screen.getByLabelText('CPF'), '111.444.777-35');
  await user.type(screen.getByLabelText('Nome ou razão social'), 'Pessoa Teste');
  await user.type(screen.getByLabelText('CEP'), '86010000');
  await user.tab();
  await waitFor(() =>
    expect((screen.getByLabelText('Bairro') as HTMLInputElement).value).toBe('Centro'),
  );
  await user.type(screen.getByLabelText('Número'), '1');
  await user.click(screen.getByRole('button', { name: 'Cadastrar cliente' }));
  await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST')).toBe(true));
  expect(posted(calls)).toMatchObject({ documentType: 'CPF', document: '11144477735' });
});

async function fillForeignAddress(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('combobox', { name: 'País' }), 'estados');
  await user.click(await screen.findByRole('option', { name: 'Estados Unidos (US)' }));
  await user.type(screen.getByLabelText('Código postal'), '99999');
  await user.type(screen.getByLabelText('Cidade'), 'Testville');
  await user.type(screen.getByLabelText('Estado ou região'), 'NY');
  await user.type(screen.getByLabelText('Logradouro'), '1 Example Street');
  await user.type(screen.getByLabelText('Número'), '1');
  await user.type(screen.getByLabelText('Bairro'), 'Downtown');
}

test('a customer abroad with a NIF, or without one', async () => {
  const calls = stubApi({
    '/api/accounts/acc/countries': [{ code: 'US', name: 'Estados Unidos' }],
    '/api/accounts/acc/customers': created,
  });
  const { user } = renderForm();
  await user.click(screen.getByRole('radio', { name: 'Cliente no exterior' }));
  expect(screen.queryByLabelText('CEP')).toBeNull();
  await user.type(screen.getByLabelText('NIF'), '00-0000000');
  await user.type(screen.getByLabelText('Nome ou razão social'), 'Foreign Customer Inc');
  await fillForeignAddress(user);
  await user.click(screen.getByRole('button', { name: 'Cadastrar cliente' }));
  await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST')).toBe(true));
  expect(posted(calls)).toEqual({
    emitterId: 'em1',
    documentType: 'NIF',
    document: '00-0000000',
    name: 'Foreign Customer Inc',
    address: {
      kind: 'foreign',
      country: 'US',
      postalCode: '99999',
      city: 'Testville',
      region: 'NY',
      street: '1 Example Street',
      number: '1',
      district: 'Downtown',
    },
  });
});

test('without a NIF the customer has no document', async () => {
  const calls = stubApi({
    '/api/accounts/acc/countries': [{ code: 'US', name: 'Estados Unidos' }],
    '/api/accounts/acc/customers': created,
  });
  const { user } = renderForm();
  await user.click(screen.getByRole('radio', { name: 'Cliente no exterior' }));
  await user.click(screen.getByLabelText('O cliente tem NIF'));
  expect(screen.queryByLabelText('NIF')).toBeNull();
  await user.type(screen.getByLabelText('Nome ou razão social'), 'No Document Ltd');
  await fillForeignAddress(user);
  await user.click(screen.getByRole('button', { name: 'Cadastrar cliente' }));
  await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST')).toBe(true));
  const body = posted(calls) as Record<string, unknown>;
  expect(body.documentType).toBe('NONE');
  expect(body).not.toHaveProperty('document');
});

test('a refused document shows its text', async () => {
  stubApi({ ...cep, '/api/accounts/acc/customers': { error: 'invalid_document' } });
  const { onCreated, user } = renderForm();
  await user.click(screen.getByRole('radio', { name: 'Cliente no Brasil' }));
  await user.type(screen.getByLabelText('CNPJ'), '11222333000180');
  await user.type(screen.getByLabelText('Nome ou razão social'), 'X');
  await user.type(screen.getByLabelText('CEP'), '86010000');
  await user.tab();
  await waitFor(() =>
    expect((screen.getByLabelText('Logradouro') as HTMLInputElement).value).toBe('Rua Teste'),
  );
  await user.type(screen.getByLabelText('Número'), '1');
  await user.click(screen.getByRole('button', { name: 'Cadastrar cliente' }));
  expect(await screen.findByText('CPF, CNPJ ou NIF inválido.')).toBeTruthy();
  expect(onCreated).not.toHaveBeenCalled();
});

test('with two emitters the form asks which one', async () => {
  stubApi({});
  renderForm({ emitters: [emitter('em1', 'EMPRESA UM'), emitter('em2', 'EMPRESA DOIS')] });
  const select = screen.getByLabelText('Emitente') as HTMLSelectElement;
  expect([...select.options].map((o) => o.text)).toEqual(['EMPRESA UM', 'EMPRESA DOIS']);
});

test('a municipal registration typed for Brazil is not sent for a customer abroad', async () => {
  const calls = stubApi({
    '/api/accounts/acc/countries': [{ code: 'US', name: 'Estados Unidos' }],
    '/api/accounts/acc/customers': created,
  });
  const { user } = renderForm();
  await user.click(screen.getByRole('radio', { name: 'Cliente no Brasil' }));
  await user.type(screen.getByLabelText('Inscrição municipal'), '12345');
  await user.click(screen.getByRole('radio', { name: 'Cliente no exterior' }));
  await user.type(screen.getByLabelText('NIF'), '00-0000000');
  await user.type(screen.getByLabelText('Nome ou razão social'), 'Foreign Customer Inc');
  await fillForeignAddress(user);
  await user.click(screen.getByRole('button', { name: 'Cadastrar cliente' }));
  await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST')).toBe(true));
  expect(posted(calls)).not.toHaveProperty('municipalRegistration');
});

test('the CNPJ, the CPF, the CEP and the phone of a Brazil customer are masked while typed', async () => {
  stubApi({ ...cep });
  const { user } = renderForm();
  await user.click(screen.getByRole('radio', { name: 'Cliente no Brasil' }));
  await user.type(screen.getByLabelText('CNPJ'), '11222333000181');
  expect(screen.getByLabelText('CNPJ')).toHaveProperty('value', '11.222.333/0001-81');
  await user.type(screen.getByLabelText('CEP'), '86010000');
  expect(screen.getByLabelText('CEP')).toHaveProperty('value', '86010-000');
  await user.type(screen.getByLabelText('Telefone'), '43999998888');
  expect(screen.getByLabelText('Telefone')).toHaveProperty('value', '(43) 99999-8888');
  await user.selectOptions(screen.getByLabelText('Tipo de documento'), 'CPF');
  await user.clear(screen.getByLabelText('CPF'));
  await user.type(screen.getByLabelText('CPF'), '12345678901');
  expect(screen.getByLabelText('CPF')).toHaveProperty('value', '123.456.789-01');
});
