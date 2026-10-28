// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as analytics from '../analytics/analytics';
import { stubApi } from '../test/stubApi';
import { ShareInvoice } from './ShareInvoice';

vi.mock('../analytics/analytics');

const LINK = 'https://notaflow.vapulab.com/n/tok123';
const TEXT = `Segue a NFS-e nº 7 de Vapulab Ltda: ${LINK}`;
const LINK_PATH = '/api/accounts/acc/invoices/inv1/link';

function renderShare(extra: { onNotaflowEmail?: () => void } = {}) {
  return render(
    <ShareInvoice
      accountId="acc"
      invoiceId="inv1"
      number="7"
      emitterName="Vapulab Ltda"
      {...extra}
    />,
  );
}

// user-event installs its own clipboard on setup(), so the spy goes on after it.
function setupUser() {
  const user = userEvent.setup();
  return { user, writeText: vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue() };
}

beforeEach(() => {
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test('"Copiar link" asks for the link once, copies it, and reuses it', async () => {
  const calls = stubApi({ [LINK_PATH]: { url: LINK } });
  renderShare();
  const { user, writeText } = setupUser();
  await user.click(screen.getByRole('button', { name: 'Copiar link' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
  await user.click(screen.getByRole('button', { name: 'Copiar link' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
  expect(calls.filter((c) => c.url === LINK_PATH && c.init?.method === 'POST')).toHaveLength(1);
  expect(analytics.track).toHaveBeenCalledWith('danfse_shared', { channel: 'copy' });
});

test('a failed clipboard shows the URL in a read-only field', async () => {
  stubApi({ [LINK_PATH]: { url: LINK } });
  renderShare();
  const { user, writeText } = setupUser();
  writeText.mockRejectedValue(new Error('denied'));
  await user.click(screen.getByRole('button', { name: 'Copiar link' }));
  const field = await screen.findByDisplayValue(LINK);
  expect((field as HTMLInputElement).readOnly).toBe(true);
});

test('a link error is shown to the user', async () => {
  stubApi({ [LINK_PATH]: { error: 'not_found' } });
  renderShare();
  const { user, writeText } = setupUser();
  await user.click(screen.getByRole('button', { name: 'Copiar link' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(writeText).not.toHaveBeenCalled();
});

test('the native share item calls navigator.share in the click tick, with the URL cached', async () => {
  stubApi({ [LINK_PATH]: { url: LINK } });
  const share = vi.fn(async () => {});
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  renderShare();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Compartilhar' }));
  const item = await screen.findByRole('button', { name: 'Compartilhar pelo celular' });
  expect(share).not.toHaveBeenCalled();
  fireEvent.click(item);
  expect(share).toHaveBeenCalledWith({ text: TEXT });
  await waitFor(() =>
    expect(analytics.track).toHaveBeenCalledWith('danfse_shared', { channel: 'native' }),
  );
});

test.each(['AbortError', 'NotAllowedError'])('%s from navigator.share is silent', async (name) => {
  stubApi({ [LINK_PATH]: { url: LINK } });
  const share = vi.fn(async () => {
    throw new DOMException('x', name);
  });
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  renderShare();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Compartilhar' }));
  await user.click(await screen.findByRole('button', { name: 'Compartilhar pelo celular' }));
  await waitFor(() => expect(share).toHaveBeenCalled());
  expect(screen.queryByRole('alert')).toBeNull();
  expect(analytics.track).not.toHaveBeenCalled();
});

test('desktop with navigator.share still lists WhatsApp and the e-mail app', async () => {
  stubApi({ [LINK_PATH]: { url: LINK } });
  Object.defineProperty(navigator, 'share', { value: vi.fn(), configurable: true });
  renderShare();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Compartilhar' }));
  expect(await screen.findByRole('link', { name: 'WhatsApp' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'E-mail pelo seu app' })).toBeTruthy();
});

test('a failed fetch shows the error with a retry, and Escape closes the panel', async () => {
  let ok = false;
  stubApi({ [LINK_PATH]: () => (ok ? { url: LINK } : { error: 'not_found' }) });
  renderShare();
  const user = userEvent.setup();
  const trigger = screen.getByRole('button', { name: 'Compartilhar' });
  await user.click(trigger);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Gerando o link…')).toBeNull();
  ok = true;
  await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
  expect(await screen.findByRole('link', { name: 'WhatsApp' })).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('link', { name: 'WhatsApp' })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test('the NotaFlow e-mail item shows only with a handler and calls it', async () => {
  stubApi({ [LINK_PATH]: { url: LINK } });
  const onNotaflowEmail = vi.fn();
  renderShare({ onNotaflowEmail });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Compartilhar' }));
  await user.click(await screen.findByRole('button', { name: 'Enviar por e-mail (NotaFlow)' }));
  expect(onNotaflowEmail).toHaveBeenCalledTimes(1);
  expect(analytics.track).toHaveBeenCalledWith('danfse_shared', { channel: 'notaflow_email' });
  expect(screen.queryByRole('link', { name: 'WhatsApp' })).toBeNull();
});
