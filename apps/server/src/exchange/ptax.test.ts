import { MockAgent } from 'undici';
import { beforeEach, expect, test } from 'vitest';
import { convertToCents, fetchPtaxSell } from './ptax';

const HOST = 'https://olinda.bcb.gov.br';
let agent: MockAgent;
beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});

function reply(date: string, bulletins: { tipoBoletim: string; cotacaoVenda: number }[]) {
  agent
    .get(HOST)
    .intercept({ path: (path) => path.includes(`dataCotacao=%27${date}%27`), method: 'GET' })
    .reply(200, { value: bulletins.map((b) => ({ ...b, cotacaoCompra: b.cotacaoVenda - 0.0006 })) });
}

test('takes the sell rate of the closing bulletin on the date', async () => {
  reply('08-31-2026', [
    { tipoBoletim: 'Abertura', cotacaoVenda: 5.1814 },
    { tipoBoletim: 'Fechamento PTAX', cotacaoVenda: 5.4321 },
  ]);
  expect(await fetchPtaxSell({ currency: 'USD', date: '2026-08-31', dispatcher: agent })).toEqual({
    currency: 'USD',
    date: '2026-08-31',
    rateE4: 54321,
    source: 'PTAX venda, fechamento',
  });
});

test('walks back to the last business day when the date has no closing bulletin', async () => {
  reply('08-30-2026', []);
  reply('08-29-2026', []);
  reply('08-28-2026', [{ tipoBoletim: 'Fechamento PTAX', cotacaoVenda: 5.2005 }]);
  expect(await fetchPtaxSell({ currency: 'USD', date: '2026-08-30', dispatcher: agent })).toMatchObject({
    date: '2026-08-28',
    rateE4: 52005,
  });
});

test('gives up after maxDaysBack', async () => {
  for (const d of ['10-10-2026', '10-09-2026']) reply(d, []);
  await expect(
    fetchPtaxSell({ currency: 'USD', date: '2026-10-10', dispatcher: agent, maxDaysBack: 1 }),
  ).rejects.toThrow(/PTAX/);
});

test('convertToCents: 1234.00 USD at 5.4321 is R$ 6703.21, rounded half up', () => {
  expect(convertToCents(123400, 54321)).toBe(670321);
  expect(convertToCents(1, 54321)).toBe(5);
});

test('an error answer from the PTAX service fails instead of reading as no quote', async () => {
  agent.get(HOST).intercept({ path: () => true, method: 'GET' }).reply(503, 'down');
  await expect(fetchPtaxSell({ currency: 'USD', date: '2026-08-31', dispatcher: agent })).rejects.toThrow(/503/);
});
