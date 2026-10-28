// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as analytics from '../analytics/analytics';
import { stubApi } from '../test/stubApi';
import { mailtoNavigation, ShareInvoice } from './ShareInvoice';

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
  expect(await screen.findByRole('button', { name: 'WhatsApp' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'E-mail pelo seu app' })).toBeTruthy();
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
  expect(await screen.findByRole('button', { name: 'WhatsApp' })).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('button', { name: 'WhatsApp' })).toBeNull();
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
  expect(analytics.track).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'WhatsApp' })).toBeNull();
});

async function openPanel() {
  stubApi({ [LINK_PATH]: { url: LINK } });
  const view = renderShare();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Compartilhar' }));
  await screen.findByRole('button', { name: 'WhatsApp' });
  return { user, view };
}

test('WhatsApp opens wa.me from the click, with noopener', async () => {
  const { user } = await openPanel();
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  await user.click(screen.getByRole('button', { name: 'WhatsApp' }));
  expect(open).toHaveBeenCalledWith(
    `https://wa.me/?text=${encodeURIComponent(TEXT)}`,
    '_blank',
    'noopener,noreferrer',
  );
  expect(analytics.track).toHaveBeenCalledWith('danfse_shared', { channel: 'whatsapp' });
});

test('the e-mail app item builds the mailto in the click', async () => {
  const { user } = await openPanel();
  const open = vi.spyOn(mailtoNavigation, 'open').mockImplementation(() => {});
  await user.click(screen.getByRole('button', { name: 'E-mail pelo seu app' }));
  expect(open).toHaveBeenCalledWith(
    `mailto:?subject=${encodeURIComponent('NFS-e nº 7 de Vapulab Ltda')}&body=${encodeURIComponent(TEXT)}`,
  );
});

test('no anchor carries the link, and every element holding it is out of session recordings', async () => {
  const { user } = await openPanel();
  expect(document.querySelectorAll('a')).toHaveLength(0);
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
  await user.click(screen.getByRole('button', { name: 'Copiar link' }));
  await screen.findByDisplayValue(LINK);
  for (const element of document.body.querySelectorAll('*')) {
    const holds = [...element.attributes].some((a) => a.value.includes('tok123'));
    if (holds) expect(element.closest('.ph-no-capture'), element.outerHTML).not.toBeNull();
  }
  expect(screen.getByLabelText('Link da nota').closest('.ph-no-capture')).not.toBeNull();
});

test('the panel is a portal outside the row, so a clipping parent cannot cut it', async () => {
  const { view } = await openPanel();
  const item = screen.getByRole('button', { name: 'WhatsApp' });
  expect(view.container.contains(item)).toBe(false);
  expect(item.closest('ul')?.style.position).toBe('fixed');
});

test('Escape closes the panel inside a parent that stops keydown propagation', async () => {
  stubApi({ [LINK_PATH]: { url: LINK } });
  render(
    <div onKeyDown={(event) => event.stopPropagation()}>
      <ShareInvoice accountId="acc" invoiceId="inv1" number="7" emitterName="Vapulab Ltda" />
    </div>,
  );
  const user = userEvent.setup();
  const trigger = screen.getByRole('button', { name: 'Compartilhar' });
  await user.click(trigger);
  await screen.findByRole('button', { name: 'WhatsApp' });
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('button', { name: 'WhatsApp' })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test('Escape from inside the panel closes it too', async () => {
  const { user } = await openPanel();
  screen.getByRole('button', { name: 'WhatsApp' }).focus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('button', { name: 'WhatsApp' })).toBeNull();
});

test('Tab from the trigger enters the portal panel, and Tab past the last item returns to the trigger', async () => {
  const { user } = await openPanel();
  const trigger = screen.getByRole('button', { name: 'Compartilhar' });
  trigger.focus();
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'WhatsApp' }));
  await user.tab();
  await user.tab();
  expect(document.activeElement).toBe(trigger);
  expect(screen.queryByRole('button', { name: 'WhatsApp' })).toBeNull();
});

test('the icon variant has named icon buttons; copying shows a check for 2 s and announces it', async () => {
  stubApi({ [LINK_PATH]: { url: LINK } });
  render(
    <ShareInvoice
      variant="icon"
      accountId="acc"
      invoiceId="inv1"
      number="7"
      emitterName="Vapulab Ltda"
    />,
  );
  const user = userEvent.setup();
  vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  expect(screen.getByRole('button', { name: 'Compartilhar' }).textContent).toBe('');
  await user.click(screen.getByRole('button', { name: 'Copiar link' }));
  const done = await screen.findByRole('button', { name: 'Link copiado' });
  expect(done.querySelector('svg.text-success')).toBeTruthy();
  expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('Link copiado.');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Copiar link' })).toBeTruthy(), {
    timeout: 3000,
  });
});
