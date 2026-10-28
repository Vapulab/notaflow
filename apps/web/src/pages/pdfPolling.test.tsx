// @vitest-environment jsdom
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { meFor, renderWithMe } from '../test/renderWithMe';
import { stubApi } from '../test/stubApi';
import { InvoiceDetailPage } from './InvoiceDetailPage';
import { InvoicesPage } from './InvoicesPage';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const invoice = {
  id: 'inv1',
  emitterId: 'em1',
  accessKey: 'K'.repeat(50),
  number: '3',
  status: 'issued',
  environment: 'producao',
  issuedAt: '2026-09-02T16:12:54.000Z',
  competence: '2026-08-31',
  customerDocument: '00-0000000',
  customerName: 'Foreign Customer Inc',
  serviceCode: '010701',
  description: 'Serviços de TI',
  serviceCents: 670321,
  issCents: null,
  netCents: 670321,
  pdfStatus: 'pending',
  sefinMessages: null,
  templateOf: null,
  events: [],
};

const settle = () => act(() => vi.advanceTimersByTimeAsync(0));
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const listCalls = (calls: { url: string }[]) =>
  calls.filter((c) => c.url.startsWith('/api/accounts/acc/invoices?')).length;

test('the list polls every 3 s only while a visible row is pending, and stops after it is ready', async () => {
  let status = 'pending';
  const calls = stubApi({
    '/api/accounts/acc/invoices': () => ({
      items: [{ ...invoice, pdfStatus: status }],
      total: 1,
    }),
    '/api/accounts/acc/emitters': [],
  });
  renderWithMe(<InvoicesPage accountId="acc" />, meFor('user'));
  await settle();
  expect(screen.getByRole('button', { name: /gerando pdf…/i })).toBeTruthy();
  expect(listCalls(calls)).toBe(1);
  await tick(3000);
  expect(listCalls(calls)).toBe(2);
  await tick(3000);
  expect(listCalls(calls)).toBe(3);
  status = 'ready';
  await tick(3000);
  expect(listCalls(calls)).toBe(4);
  expect(screen.getByRole('button', { name: 'PDF' })).toBeTruthy();
  await tick(10_000);
  expect(listCalls(calls)).toBe(4);
});

test('the list does not poll when no row is pending', async () => {
  const calls = stubApi({
    '/api/accounts/acc/invoices': { items: [{ ...invoice, pdfStatus: 'ready' }], total: 1 },
    '/api/accounts/acc/emitters': [],
  });
  renderWithMe(<InvoicesPage accountId="acc" />, meFor('user'));
  await settle();
  await tick(10_000);
  expect(listCalls(calls)).toBe(1);
});

test('the list stops polling when the page unmounts', async () => {
  const calls = stubApi({
    '/api/accounts/acc/invoices': { items: [invoice], total: 1 },
    '/api/accounts/acc/emitters': [],
  });
  const view = renderWithMe(<InvoicesPage accountId="acc" />, meFor('user'));
  await settle();
  view.unmount();
  await tick(10_000);
  expect(listCalls(calls)).toBe(1);
});

test('the detail polls its invoice while the PDF is pending and keeps the download', async () => {
  let status = 'pending';
  const calls = stubApi({
    '/api/accounts/acc/invoices/inv1': () => ({ ...invoice, pdfStatus: status }),
  });
  renderWithMe(<InvoiceDetailPage accountId="acc" invoiceId="inv1" />, meFor('user'));
  await settle();
  expect(screen.getByRole('button', { name: /gerando pdf…/i })).toBeTruthy();
  await tick(3000);
  expect(calls).toHaveLength(2);
  status = 'ready';
  await tick(3000);
  expect(calls).toHaveLength(3);
  expect(screen.getByRole('button', { name: 'Baixar PDF (DANFS-e)' })).toBeTruthy();
  await tick(10_000);
  expect(calls).toHaveLength(3);
});

test('a slow fetch is never overlapped, and its answer still updates the row', async () => {
  let started = 0;
  let status = 'pending';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/accounts/acc/emitters')) return Response.json([]);
      started += 1;
      const body = { items: [{ ...invoice, pdfStatus: status }], total: 1 };
      // The first load is quick; later ones take 7 s.
      if (started > 1) {
        status = 'ready';
        await new Promise((resolve) => setTimeout(resolve, 7000));
        return Response.json({ items: [{ ...invoice, pdfStatus: 'ready' }], total: 1 });
      }
      return Response.json(body);
    }),
  );
  renderWithMe(<InvoicesPage accountId="acc" />, meFor('user'));
  await settle();
  await tick(3000);
  expect(started).toBe(2);
  await tick(3000);
  expect(started).toBe(2);
  await tick(4000);
  expect(screen.getByRole('button', { name: 'PDF' })).toBeTruthy();
  await tick(10_000);
  expect(started).toBe(2);
});
