// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { Service } from '../api';
import { installDialogPolyfill } from '../test/dialog';
import { stubApi } from '../test/stubApi';
import { ServiceDialog } from './ServiceDialog';

beforeAll(installDialogPolyfill);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const service: Service = {
  id: 's1',
  emitterId: 'em1',
  name: 'Suporte',
  nationalTaxCode: '010101',
  description: 'Suporte técnico',
  origin: 'manual',
  archived: false,
};
const OPERATION = 'Indicador de operação (IBS/CBS)';

async function open(saved: Service) {
  const calls = stubApi({
    '/api/accounts/acc/service-codes': [
      { code: '010701', description: 'Suporte técnico em informática.' },
    ],
  });
  const user = userEvent.setup();
  render(
    <ServiceDialog
      accountId="acc"
      emitterId="em1"
      service={saved}
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Mais opções' }));
  return { calls, user };
}
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

test('a Brazil service shows the defaults of its item, and they follow a new code', async () => {
  const { user } = await open(service);
  expect(value(OPERATION)).toBe('100301');
  await user.type(screen.getByRole('combobox', { name: 'Código nacional' }), 'suporte');
  await user.click(
    await screen.findByRole('option', { name: '01.07.01 – Suporte técnico em informática.' }),
  );
  expect(value(OPERATION)).toBe('050101');
});

test('a service with export details shows no Brazil defaults', async () => {
  const exp = {
    mode: '1',
    providerLink: '0',
    providerSupport: '01',
    customerSupport: '01',
    temporaryGoods: '0',
    mdic: '0',
  } as const;
  await open({ ...service, export: exp });
  expect(value(OPERATION)).toBe('');
});

test('a typed code stays when the code changes', async () => {
  const { user } = await open(service);
  const op = screen.getByLabelText(OPERATION);
  await user.clear(op);
  await user.type(op, '100302');
  await user.type(screen.getByRole('combobox', { name: 'Código nacional' }), 'suporte');
  await user.click(
    await screen.findByRole('option', { name: '01.07.01 – Suporte técnico em informática.' }),
  );
  expect(value(OPERATION)).toBe('100302');
});
