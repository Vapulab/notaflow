// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import * as analytics from '../analytics/analytics';
import { installDialogPolyfill } from '../test/dialog';
import { stubApi } from '../test/stubApi';
import { ERROR_TEXT } from './Layout';
import { SendInvoiceEmail } from './SendInvoiceEmail';

vi.mock('../analytics/analytics');

const DETAIL = '/api/accounts/acc/invoices/inv1';
const detail = (customerEmail: string | null) => ({ id: 'inv1', customerEmail });

beforeAll(installDialogPolyfill);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderDialog(onClose = vi.fn(), onSent = vi.fn()) {
  render(
    <SendInvoiceEmail
      open
      accountId="acc"
      invoiceId="inv1"
      number="7"
      onClose={onClose}
      onSent={onSent}
    />,
  );
  return { onClose, onSent };
}

test('the field starts with the address of the customer and the send posts it', async () => {
  const calls = stubApi({
    [DETAIL]: detail('cliente@example.com'),
    [`${DETAIL}/email`]: { sent: true },
  });
  const { onSent } = renderDialog();
  const user = userEvent.setup();
  const field = await screen.findByLabelText('E-mail do tomador');
  await waitFor(() => expect((field as HTMLInputElement).value).toBe('cliente@example.com'));
  await user.click(screen.getByRole('button', { name: 'Enviar' }));
  expect(await screen.findByText('E-mail enviado para cliente@example.com.')).toBeTruthy();
  const post = calls.find((c) => c.url === `${DETAIL}/email`);
  expect(JSON.parse(String(post?.init?.body))).toEqual({ to: 'cliente@example.com' });
  expect(analytics.track).toHaveBeenCalledWith('danfse_shared', { channel: 'notaflow_email' });
  expect(onSent).toHaveBeenCalledTimes(1);
});

test('an empty field takes a typed address, and a bad one is refused before the request', async () => {
  const calls = stubApi({ [DETAIL]: detail(null), [`${DETAIL}/email`]: { sent: true } });
  renderDialog();
  const user = userEvent.setup();
  const field = await screen.findByLabelText('E-mail do tomador');
  await user.type(field, 'sem-arroba');
  await user.click(screen.getByRole('button', { name: 'Enviar' }));
  expect(await screen.findByText('Digite um e-mail válido.')).toBeTruthy();
  expect(calls.some((c) => c.url === `${DETAIL}/email`)).toBe(false);
  await user.clear(field);
  await user.type(field, 'novo@example.com');
  await user.click(screen.getByRole('button', { name: 'Enviar' }));
  expect(await screen.findByText('E-mail enviado para novo@example.com.')).toBeTruthy();
});

test('a refused send shows the error and tracks nothing', async () => {
  stubApi({
    [DETAIL]: detail('cliente@example.com'),
    [`${DETAIL}/email`]: { error: 'too_many_requests' },
  });
  renderDialog();
  const user = userEvent.setup();
  await waitFor(() =>
    expect((screen.getByLabelText('E-mail do tomador') as HTMLInputElement).value).not.toBe(''),
  );
  await user.click(screen.getByRole('button', { name: 'Enviar' }));
  expect(await screen.findByText(ERROR_TEXT.too_many_requests ?? '')).toBeTruthy();
  expect(analytics.track).not.toHaveBeenCalled();
});

test('Cancelar closes the dialog', async () => {
  stubApi({ [DETAIL]: detail(null) });
  const { onClose } = renderDialog();
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Cancelar' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
