// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { stubApi } from '../test/stubApi';
import { AdminBugPage, type AdminBugReport } from './AdminBugPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const REPORT: AdminBugReport = {
  id: 'r1',
  title: 'Botão travou',
  description: 'Cliquei em Emitir.',
  pagePath: '/app/acc/notas',
  userAgent: 'Mozilla/5.0',
  status: 'open',
  closedAt: null,
  createdAt: '2026-10-21T12:00:00Z',
  githubIssueUrl: 'https://github.com/Vapulab/notaflow/issues/9',
  notionPageUrl: null,
  accountId: 'acc',
  accountName: 'Padaria Exemplo',
  reporterEmail: 'ana@example.com',
  reporterName: 'Ana',
  images: [
    { position: 1, contentType: 'image/webp', sizeBytes: 10, purgedAt: null },
    { position: 2, contentType: 'image/png', sizeBytes: 10, purgedAt: null },
  ],
};

test('the admin page shows the report and its images from the admin route', async () => {
  stubApi({ '/api/admin/bug-reports/r1': REPORT });
  render(<AdminBugPage reportId="r1" />);
  expect(await screen.findByText('Botão travou')).toBeTruthy();
  expect(screen.getByText('Cliquei em Emitir.')).toBeTruthy();
  expect(screen.getByText(/Padaria Exemplo/)).toBeTruthy();
  expect(screen.getByText(/ana@example.com/)).toBeTruthy();
  expect(screen.getByText('/app/acc/notas')).toBeTruthy();
  expect(screen.getByText(REPORT.githubIssueUrl ?? '')).toBeTruthy();
  expect(screen.getByAltText('Imagem 1 do relato').getAttribute('src')).toBe(
    '/api/admin/bug-reports/r1/images/1',
  );
  expect(screen.getByAltText('Imagem 2 do relato')).toBeTruthy();
});

test('after the purge the page says when the images were deleted', async () => {
  stubApi({
    '/api/admin/bug-reports/r1': {
      ...REPORT,
      status: 'closed',
      closedAt: '2026-09-01T12:00:00Z',
      images: REPORT.images.map((image) => ({ ...image, purgedAt: '2026-10-02T12:00:00Z' })),
    },
  });
  render(<AdminBugPage reportId="r1" />);
  expect(await screen.findByText(/As imagens foram apagadas em 02\/10\/2026/)).toBeTruthy();
  expect(screen.queryByAltText('Imagem 1 do relato')).toBeNull();
});

test('a person who is not an admin sees the error', async () => {
  stubApi({ '/api/admin/bug-reports/r1': { error: 'admin_only' } });
  render(<AdminBugPage reportId="r1" />);
  expect(await screen.findByRole('alert')).toBeTruthy();
});
