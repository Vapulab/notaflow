// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { meFor, renderWithMe } from '../test/renderWithMe';
import { stubApi } from '../test/stubApi';
import { LegalGate } from './LegalGate';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pending = { ...meFor('user'), legalVersion: '2026-10-11', legalAccepted: false };

test('a user who has not accepted the current terms accepts them before any screen', async () => {
  const calls = stubApi({ '/api/me/legal-acceptance': {} });
  renderWithMe(
    <LegalGate>
      <p>Painel</p>
    </LegalGate>,
    pending,
  );
  expect(screen.queryByText('Painel')).toBeNull();
  expect(screen.getByRole('link', { name: 'Termos de uso' }).getAttribute('href')).toBe('/termos');
  const go = screen.getByRole('button', { name: 'Continuar' });
  expect(go).toHaveProperty('disabled', true);
  const user = userEvent.setup();
  await user.click(screen.getByRole('checkbox', { name: /Li e aceito/ }));
  await user.click(go);
  expect(await screen.findByText('Painel')).toBeTruthy();
  const sent = calls.find((c) => c.url === '/api/me/legal-acceptance');
  expect(JSON.parse(String(sent?.init?.body))).toEqual({ version: '2026-10-11' });
});

test('changed terms say so, so the user reloads them', async () => {
  stubApi({ '/api/me/legal-acceptance': { error: 'legal_version_changed' } });
  renderWithMe(
    <LegalGate>
      <p>Painel</p>
    </LegalGate>,
    pending,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('checkbox', { name: /Li e aceito/ }));
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  expect(await screen.findByText(/Os termos mudaram/)).toBeTruthy();
  await waitFor(() => expect(screen.queryByText('Painel')).toBeNull());
});

test('a user who accepted goes straight to the screen', () => {
  renderWithMe(
    <LegalGate>
      <p>Painel</p>
    </LegalGate>,
    { ...pending, legalAccepted: true },
  );
  expect(screen.getByText('Painel')).toBeTruthy();
});
