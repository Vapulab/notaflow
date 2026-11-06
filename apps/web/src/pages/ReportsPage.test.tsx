// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ReportView } from '../api';
import { meFor, renderWithMe } from '../test/renderWithMe';
import { stubApi } from '../test/stubApi';
import { ReportsPage } from './ReportsPage';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-06T15:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const settle = () => act(() => vi.advanceTimersByTimeAsync(0));
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

const emitters = [
  { id: 'em1', companyName: 'Empresa Exemplo' },
  { id: 'em2', companyName: 'Vapulab' },
];

const report: ReportView = {
  id: 'r1',
  emitterId: 'em1',
  emitterName: 'Empresa Exemplo',
  period: { type: 'month', from: '2026-10-01', to: '2026-10-31' },
  status: 'ready',
  invoiceCount: 535,
  errorCode: null,
  createdByName: 'Lincoln',
  createdAt: '2026-11-06T14:24:00.000Z',
  readyAt: '2026-11-06T14:25:00.000Z',
  expiresAt: '2027-11-06T14:25:00.000Z',
};

const posts = (calls: { url: string; init?: RequestInit }[]) =>
  calls.filter((c) => c.init?.method === 'POST');
const listCalls = (calls: { url: string }[]) =>
  calls.filter((c) => c.url.startsWith('/api/accounts/acc/reports?')).length;

async function open(routes: Record<string, unknown> = {}) {
  const calls = stubApi({
    '/api/accounts/acc/emitters': emitters,
    '/api/accounts/acc/reports': { reports: [], total: 0 },
    ...routes,
  });
  renderWithMe(<ReportsPage accountId="acc" />, meFor('user'));
  await settle();
  return calls;
}

test('posts a monthly report for the previous month', async () => {
  const calls = await open();
  fireEvent.click(screen.getByRole('button', { name: 'Gerar PDF' }));
  await settle();
  const [post] = posts(calls);
  expect(post?.url).toBe('/api/accounts/acc/reports');
  expect(JSON.parse(String(post?.init?.body))).toEqual({
    emitterId: 'em1',
    period: 'month',
    month: '2026-10',
  });
});

test('posts a yearly report for the current year', async () => {
  const calls = await open();
  fireEvent.click(screen.getByRole('button', { name: 'Anual' }));
  fireEvent.click(screen.getByRole('button', { name: 'Gerar PDF' }));
  await settle();
  expect(JSON.parse(String(posts(calls)[0]?.init?.body))).toEqual({
    emitterId: 'em1',
    period: 'year',
    year: 2026,
  });
});

test('posts a range', async () => {
  const calls = await open();
  fireEvent.click(screen.getByRole('button', { name: 'Por período' }));
  fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-07-01' } });
  fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-09-30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Gerar PDF' }));
  await settle();
  expect(JSON.parse(String(posts(calls)[0]?.init?.body))).toEqual({
    emitterId: 'em1',
    period: 'range',
    from: '2026-07-01',
    to: '2026-09-30',
  });
});

test('shows who asked and when, in Brasília time', async () => {
  await open({ '/api/accounts/acc/reports': { reports: [report], total: 1 } });
  expect(screen.getByText('Lincoln · 06/11 11:24')).toBeTruthy();
  expect(screen.getByRole('cell', { name: 'Outubro de 2026' })).toBeTruthy();
});

test('polls while a report is open and stops when ready', async () => {
  let status: ReportView['status'] = 'running';
  const calls = await open({
    '/api/accounts/acc/reports': () => ({ reports: [{ ...report, status }], total: 1 }),
  });
  expect(screen.getByText('Gerando…')).toBeTruthy();
  expect(listCalls(calls)).toBe(1);
  status = 'ready';
  await tick(3000);
  expect(listCalls(calls)).toBe(2);
  expect(screen.getByRole('button', { name: 'Baixar' })).toBeTruthy();
  await tick(10_000);
  expect(listCalls(calls)).toBe(2);
});

test('shows the too-large message', async () => {
  await open({
    '/api/accounts/acc/reports': (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? { error: 'report_too_large' } : { reports: [], total: 0 },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Gerar PDF' }));
  await settle();
  expect(
    screen.getByText('O período tem mais de 20.000 notas. Escolha um período menor.'),
  ).toBeTruthy();
});

test('retries a failed report', async () => {
  const calls = await open({
    '/api/accounts/acc/reports': { reports: [{ ...report, status: 'failed' }], total: 1 },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
  await settle();
  expect(posts(calls)[0]?.url).toBe('/api/accounts/acc/reports/r1/retry');
});
