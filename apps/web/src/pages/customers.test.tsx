// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { stubApi } from '../test/stubApi';
import { CustomerPage } from './CustomerPage';
import { CustomersPage } from './CustomersPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const customer = {
  id: 'c1',
  emitterId: 'em1',
  documentType: 'CNPJ',
  document: '98765432000110',
  name: 'Cliente Exemplo Ltda',
  email: 'financeiro@example.com',
  phone: null,
  municipalRegistration: null,
  address: null,
  origin: 'imported',
  archived: false,
};

test('the customer list links each customer and searches by name or document', async () => {
  const calls = stubApi({ '/api/accounts/acc/customers': [customer] });
  render(<CustomersPage accountId="acc" />);
  const link = await screen.findByRole('link', { name: 'Cliente Exemplo Ltda' });
  expect(link.getAttribute('href')).toBe('#/a/acc/customers/c1');
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/pesquisar/i), 'Exemplo');
  await waitFor(() => expect(calls.some((c) => c.url.endsWith('?q=Exemplo'))).toBe(true));
});

test('saving sends only the changed fields', async () => {
  const calls = stubApi({ '/api/accounts/acc/customers/c1': customer });
  render(<CustomerPage accountId="acc" customerId="c1" />);
  const user = userEvent.setup();
  const email = await screen.findByLabelText('E-mail');
  await user.clear(email);
  await user.type(email, 'contas@example.com');
  await user.click(screen.getByRole('button', { name: 'Salvar' }));
  await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT')).toBe(true));
  expect(JSON.parse(String(calls.find((c) => c.init?.method === 'PUT')?.init?.body))).toEqual({
    email: 'contas@example.com',
  });
  expect(await screen.findByText(/não sobrescreve/i)).toBeTruthy();
});

test('a domestic address sends the municipality chosen in the list, with the street fields', async () => {
  const calls = stubApi({
    '/api/accounts/acc/customers/c1': customer,
    '/api/accounts/acc/municipalities': [{ code: '3550308', name: 'São Paulo', uf: 'SP' }],
  });
  render(<CustomerPage accountId="acc" customerId="c1" />);
  const user = userEvent.setup();
  await user.type(await screen.findByRole('combobox', { name: 'Município' }), 'sao paulo');
  await user.click(await screen.findByRole('option', { name: 'São Paulo - SP' }));
  await user.type(screen.getByLabelText('CEP'), '01001000');
  await user.type(screen.getByLabelText('Logradouro'), 'Praça da Sé');
  await user.type(screen.getByLabelText('Número'), '1');
  await user.type(screen.getByLabelText('Bairro'), 'Sé');
  await user.click(screen.getByRole('button', { name: 'Salvar' }));
  await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT')).toBe(true));
  expect(JSON.parse(String(calls.find((c) => c.init?.method === 'PUT')?.init?.body))).toEqual({
    address: {
      kind: 'domestic',
      municipality: '3550308',
      zip: '01001000',
      street: 'Praça da Sé',
      number: '1',
      district: 'Sé',
    },
  });
});
