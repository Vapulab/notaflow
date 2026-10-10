// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { stubApi } from '../test/stubApi';
import {
  type AddressValue,
  AddressFields,
  addressFromParty,
  emptyAddress,
  toPartyAddress,
} from './AddressFields';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const londrina = { code: '4113700', name: 'Londrina', uf: 'PR' };

let latest: AddressValue = emptyAddress('domestic');
function Harness(props: { initial: AddressValue }) {
  const [value, setValue] = useState(props.initial);
  latest = value;
  return <AddressFields accountId="acc" value={value} onChange={setValue} />;
}

test('a CEP fills the street, the district, and the municipality', async () => {
  const calls = stubApi({
    '/api/accounts/acc/cep/86010000': {
      zip: '86010000',
      street: 'Rua Teste',
      district: 'Centro',
      municipality: londrina,
    },
  });
  render(<Harness initial={emptyAddress('domestic')} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('CEP'), '86010-000');
  await user.tab();
  await waitFor(() => expect(latest.street).toBe('Rua Teste'));
  expect(calls.some((c) => c.url.endsWith('/cep/86010000'))).toBe(true);
  expect(latest.district).toBe('Centro');
  expect(latest.municipality).toEqual(londrina);
  expect(latest.zip).toBe('86010000');
  expect(screen.getByDisplayValue('Londrina - PR')).toBeTruthy();
});

test('an unknown CEP says so and keeps the fields', async () => {
  stubApi({ '/api/accounts/acc/cep/99999999': { error: 'cep_not_found' } });
  render(<Harness initial={{ ...emptyAddress('domestic'), street: 'Rua Minha' }} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('CEP'), '99999999');
  await user.tab();
  expect(await screen.findByText(/CEP não encontrado/)).toBeTruthy();
  expect(latest.street).toBe('Rua Minha');
});

test('the municipality list searches by name and selects one', async () => {
  const calls = stubApi({ '/api/accounts/acc/municipalities': [londrina] });
  render(<Harness initial={emptyAddress('domestic')} />);
  const user = userEvent.setup();
  await user.type(screen.getByRole('combobox', { name: 'Município' }), 'lond');
  await user.click(await screen.findByRole('option', { name: 'Londrina - PR' }));
  expect(latest.municipality).toEqual(londrina);
  expect(calls.some((c) => c.url.endsWith('/municipalities?q=lond'))).toBe(true);
});

test('abroad: the country list replaces the CEP and the municipality', async () => {
  stubApi({ '/api/accounts/acc/countries': [{ code: 'US', name: 'Estados Unidos' }] });
  render(<Harness initial={emptyAddress('foreign')} />);
  const user = userEvent.setup();
  expect(screen.queryByLabelText('CEP')).toBeNull();
  await user.type(screen.getByRole('combobox', { name: 'País' }), 'estados');
  await user.click(await screen.findByRole('option', { name: 'Estados Unidos (US)' }));
  expect(latest.country).toEqual({ code: 'US', name: 'Estados Unidos' });
});

test('a saved address shows the name of its municipality', async () => {
  stubApi({ '/api/accounts/acc/municipalities': [londrina] });
  const saved = addressFromParty(
    {
      kind: 'domestic',
      municipality: '4113700',
      zip: '86010000',
      street: 'Rua Teste',
      number: '1',
      district: 'Centro',
    },
    'domestic',
  );
  render(<Harness initial={saved} />);
  expect(await screen.findByDisplayValue('Londrina - PR')).toBeTruthy();
});

test('toPartyAddress needs every required field', () => {
  const full: AddressValue = {
    ...emptyAddress('domestic'),
    municipality: londrina,
    zip: '86010000',
    street: 'Rua Teste',
    number: '1',
    district: 'Centro',
  };
  expect(toPartyAddress(full)).toEqual({
    kind: 'domestic',
    municipality: '4113700',
    zip: '86010000',
    street: 'Rua Teste',
    number: '1',
    district: 'Centro',
  });
  expect(toPartyAddress({ ...full, number: ' ' })).toBeNull();
  expect(toPartyAddress({ ...full, municipality: null })).toBeNull();
});

test('passing through an unchanged CEP does not look it up again', async () => {
  const calls = stubApi({ '/api/accounts/acc/municipalities': [londrina] });
  const saved = addressFromParty(
    {
      kind: 'domestic',
      municipality: '4113700',
      zip: '86010000',
      street: 'Rua Minha',
      number: '1',
      district: 'Jardim X (Gleba 2)',
    },
    'domestic',
  );
  render(<Harness initial={saved} />);
  const user = userEvent.setup();
  await user.click(screen.getByLabelText('CEP'));
  await user.tab();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(calls.some((c) => c.url.includes('/cep/'))).toBe(false);
  expect(latest.district).toBe('Jardim X (Gleba 2)');
});

test('a CEP lookup fills only empty fields; typed ones stay', async () => {
  stubApi({
    '/api/accounts/acc/cep/86010000': {
      zip: '86010000',
      street: 'Rua Teste',
      district: 'Centro',
      municipality: londrina,
    },
  });
  render(<Harness initial={{ ...emptyAddress('domestic'), street: 'Rua Minha' }} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('CEP'), '86010000');
  await user.tab();
  await waitFor(() => expect(latest.district).toBe('Centro'));
  expect(latest.street).toBe('Rua Minha');
  expect(latest.municipality).toEqual(londrina);
});
