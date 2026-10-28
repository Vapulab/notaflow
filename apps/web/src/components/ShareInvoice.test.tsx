// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

test('"Compartilhar" uses the native share sheet when present', async () => {
  stubApi({ [LINK_PATH]: { url: LINK } });
  const share = vi.fn(async () => {});
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  renderShare();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Compartilhar' }));
  await waitFor(() => expect(share).toHaveBeenCalledWith({ text: TEXT }));
  expect(analytics.track).toHaveBeenCalledWith('danfse_shared', { channel: 'native' });
  expect(screen.queryByRole('menu')).toBeNull();
});

test('without native share the menu offers WhatsApp and the e-mail app, and tracks each', async () => {
  stubApi({ [LINK_PATH]: { url: LINK } });
  renderShare();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Compartilhar' }));
  const whatsapp = await screen.findByRole('menuitem', { name: 'WhatsApp' });
  expect(whatsapp.getAttribute('href')).toBe(`https://wa.me/?text=${encodeURIComponent(TEXT)}`);
  const mail = screen.getByRole('menuitem', { name: 'E-mail pelo seu app' });
  expect(mail.getAttribute('href')).toBe(
    `mailto:?subject=${encodeURIComponent('NFS-e nº 7 de Vapulab Ltda')}&body=${encodeURIComponent(TEXT)}`,
  );
  expect(screen.queryByRole('menuitem', { name: /NotaFlow/ })).toBeNull();
  whatsapp.addEventListener('click', (e) => e.preventDefault());
  await user.click(whatsapp);
  expect(analytics.track).toHaveBeenCalledWith('danfse_shared', { channel: 'whatsapp' });
  await user.click(screen.getByRole('button', { name: 'Compartilhar' }));
  const again = await screen.findByRole('menuitem', { name: 'E-mail pelo seu app' });
  again.addEventListener('click', (e) => e.preventDefault());
  await user.click(again);
  expect(analytics.track).toHaveBeenCalledWith('danfse_shared', { channel: 'mailto' });
});

test('the NotaFlow e-mail item shows only with a handler and calls it', async () => {
  stubApi({ [LINK_PATH]: { url: LINK } });
  const onNotaflowEmail = vi.fn();
  renderShare({ onNotaflowEmail });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Compartilhar' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Enviar por e-mail (NotaFlow)' }));
  expect(onNotaflowEmail).toHaveBeenCalledTimes(1);
  expect(analytics.track).toHaveBeenCalledWith('danfse_shared', { channel: 'notaflow_email' });
  expect(screen.queryByRole('menu')).toBeNull();
});

test('Escape closes the menu and returns focus to the button', async () => {
  stubApi({ [LINK_PATH]: { url: LINK } });
  renderShare();
  const user = userEvent.setup();
  const button = screen.getByRole('button', { name: 'Compartilhar' });
  await user.click(button);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  await screen.findByRole('menu');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(button);
});
