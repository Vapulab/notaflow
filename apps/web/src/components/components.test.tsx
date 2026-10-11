// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { meFor, renderWithMe } from '../test/renderWithMe';
import { CertificateWarning } from './CertificateWarning';
import { EnvironmentBadge } from './EnvironmentBadge';
import { ERROR_TEXT, Layout } from './Layout';
import { ApiError } from '../api';
import { isDefinitive } from './useIssueSend';

afterEach(() => cleanup());

test('the environment badge says which environment, loudly, to the platform admin', () => {
  renderWithMe(<EnvironmentBadge environment="producao" />, meFor('admin'));
  expect(screen.getByText('PRODUÇÃO')).toBeTruthy();
  renderWithMe(<EnvironmentBadge environment="producao_restrita" />, meFor('admin'));
  expect(screen.getByText(/PRODUÇÃO RESTRITA/)).toBeTruthy();
});

test('the certificate warning shows only when the certificate expires soon or is missing', () => {
  const { container } = render(
    <CertificateWarning certificate={{ validTo: '2030-01-01T00:00:00Z', expiresSoon: false }} />,
  );
  expect(container.textContent).toBe('');
  render(
    <CertificateWarning certificate={{ validTo: '2026-10-20T15:00:00Z', expiresSoon: true }} />,
  );
  expect(screen.getByText(/vence em 20\/10\/2026/)).toBeTruthy();
  render(<CertificateWarning certificate={null} />);
  expect(screen.getByText(/sem certificado/i)).toBeTruthy();
});

test('the layout shows the account links and marks the current page', () => {
  window.history.replaceState(null, '', '/app/acc/notas');
  render(
    <Layout title="Notas" accountId="acc">
      <p>conteúdo</p>
    </Layout>,
  );
  expect(screen.getByRole('link', { name: 'Notas' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: 'Clientes' }).getAttribute('href')).toBe(
    '/app/acc/clientes',
  );
});

test('every error code the server can send has a text', () => {
  for (const code of [
    'template_unsupported',
    'sefin_rejected',
    'ptax_unavailable',
    'invalid_idempotency_key',
  ]) {
    expect(ERROR_TEXT[code]).toBeTruthy();
  }
});

test('the layout has Sair, which ends the Cloudflare Access session', () => {
  render(
    <Layout title="Notas">
      <p>conteúdo</p>
    </Layout>,
  );
  expect(screen.getByRole('link', { name: 'Sair' }).getAttribute('href')).toBe(
    '/cdn-cgi/access/logout',
  );
});

test('isDefinitive: a refusal before anything is reserved, never an unclear answer', () => {
  expect(isDefinitive(new ApiError(400, 'invalid_amount'))).toBe(true);
  expect(isDefinitive(new ApiError(409, 'fiscal_config_missing'))).toBe(true);
  expect(isDefinitive(new ApiError(502, 'ptax_unavailable'))).toBe(true);
  expect(isDefinitive(new ApiError(502, 'http_502'))).toBe(false);
  expect(isDefinitive(new ApiError(504, 'http_504'))).toBe(false);
  expect(isDefinitive(new ApiError(408, 'http_408'))).toBe(false);
  expect(isDefinitive(new ApiError(429, 'http_429'))).toBe(false);
  expect(isDefinitive(new TypeError('Failed to fetch'))).toBe(false);
});
