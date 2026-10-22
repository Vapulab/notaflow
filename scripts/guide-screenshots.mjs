// Screenshots of the invoice screens for /guia/primeira-nota, with synthetic data only.
// Run: pnpm exec playwright install chromium (once), pnpm build:web, then pnpm exec tsx scripts/guide-screenshots.mjs
/* global document, HTMLElement, Image, localStorage -- the page.evaluate callbacks run in the browser */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath, URL } from 'node:url';
import { chromium } from 'playwright';
import { buildApp } from '../apps/server/src/app.ts';
import { loadConfig } from '../apps/server/src/config.ts';
import { openDatabase } from '../apps/server/src/db/openDatabase.ts';
import { LEGAL_VERSION } from '../apps/server/src/legal.ts';
import { seedTenant } from '../apps/server/test/fixtures.ts';
import { startFakeNacional } from '../packages/fake-nacional/src/index.ts';
import { makeTestCertificate } from '../packages/test-kit/src/index.ts';

const EMAIL = 'dono@example.com';
const webRoot = fileURLToPath(new URL('../apps/web/dist', import.meta.url));
const outDir = fileURLToPath(new URL('../apps/web/public/guia/', import.meta.url));

// The origin must be known before the app is built, so ask the system for a free port first.
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      );
    });
  });

const fake = await startFakeNacional();
let browser;
let app;
let close;
try {
  const PORT = await freePort();
  const ORIGIN = `http://127.0.0.1:${PORT}`;
  const opened = openDatabase(':memory:');
  const db = opened.db;
  close = opened.close;
  const config = loadConfig({
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: String(PORT),
    DATABASE_PATH: ':memory:',
    APP_ORIGIN: ORIGIN,
    NFSE_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    AUTH_MODE: 'dev',
    DEV_USER_EMAIL: EMAIL,
    BETTER_AUTH_SECRET: 'screenshot-secret-'.repeat(3),
    NACIONAL_FAKE_URL: fake.urls.sefin.replace('/SefinNacional', ''),
  });
  app = buildApp({
    config,
    db,
    webRoot,
    policyNotice: null,
    onEmitterCreated: () => {},
    // A fixed PTAX: the real one is a network call.
    exchangeRate: async (currency, date) => ({
      currency,
      date,
      rateE4: 50_000,
      source: 'PTAX venda, fechamento',
    }),
  });
  await app.ready();
  const { accountId } = seedTenant(db, { accountName: 'Conta de exemplo', email: EMAIL });
  const headers = { origin: ORIGIN, 'content-type': 'application/json' };
  const call = async (method, url, payload) => {
    const answer = await app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
    if (answer.statusCode >= 300)
      throw new Error(`${method} ${url}: ${answer.statusCode} ${answer.body}`);
    return answer.body ? answer.json() : null;
  };
  await call('POST', '/api/me/legal-acceptance', { version: LEGAL_VERSION });
  await call('POST', '/api/me/tour-seen', {});
  const base = `/api/accounts/${accountId}`;
  const cert = makeTestCertificate({ cnpj: '12345678000195', companyName: 'EMPRESA EXEMPLO LTDA' });
  const { id: emitterId } = await call('POST', `${base}/emitters`, {
    pfxBase64: cert.pfx.toString('base64'),
    password: cert.password,
    municipality: '4113700',
    simplesNacional: '3',
    simplesRegime: '1',
    specialRegime: '0',
    dpsSeries: '900',
  });
  await call('PUT', `${base}/emitters/${emitterId}/fiscal`, {
    simplesAnnex: 'III',
    simplesRbt12Cents: 30_000_000,
    ibscbsRegime: 'inside_das',
  });
  await call('POST', `${base}/emitters/${emitterId}/services`, {
    name: 'Desenvolvimento de software',
    nationalTaxCode: '010101',
    nbsCode: '115080000',
    description: 'Desenvolvimento de software sob encomenda',
    pisCofinsCst: '00',
  });
  await call('POST', `${base}/customers`, {
    emitterId,
    documentType: 'CNPJ',
    document: '11222333000181',
    name: 'Cliente Exemplo Ltda',
    address: {
      kind: 'domestic',
      municipality: '4113700',
      zip: '86010000',
      street: 'Rua Exemplo',
      number: '1',
      district: 'Centro',
    },
  });
  await app.listen({ host: '127.0.0.1', port: PORT });

  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
    colorScheme: 'light',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });
  await page.addInitScript(() => localStorage.setItem('malphas-theme', 'light'));
  mkdirSync(outDir, { recursive: true });
  const shot = async (locator, name) => {
    // A focus ring or a selected date part would show in the picture.
    await page.evaluate(
      () => document.activeElement instanceof HTMLElement && document.activeElement.blur(),
    );
    const png = await locator.screenshot({ animations: 'disabled' });
    // Playwright writes PNG or JPEG only; the browser itself encodes the WebP.
    const webp = await page.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext('2d')?.drawImage(image, 0, 0);
      return canvas.toDataURL('image/webp', 0.9).split(',')[1] ?? '';
    }, png.toString('base64'));
    writeFileSync(`${outDir}${name}.webp`, Buffer.from(webp, 'base64'));
    console.log(`apps/web/public/guia/${name}.webp`);
  };

  await page.goto(`${ORIGIN}/app/${accountId}/emitentes/${emitterId}`);
  const fiscal = page.locator('form', {
    has: page.getByRole('heading', { name: 'Configuração fiscal' }),
  });
  await fiscal.getByText('alíquota efetiva').waitFor();
  await shot(fiscal, 'configuracao-fiscal');

  await page.goto(`${ORIGIN}/app/${accountId}/notas/nova`);
  const form = page.locator('form', {
    has: page.getByRole('heading', { name: 'Nova nota sem modelo' }),
  });
  await form.getByRole('combobox', { name: 'Cliente' }).fill('Cliente');
  await page.getByRole('option', { name: /Cliente Exemplo Ltda/ }).click();
  await form
    .locator('select')
    .first()
    .selectOption({ label: 'Desenvolvimento de software (01.01.01)' });
  await form.locator('textarea').fill('Desenvolvimento de software sob encomenda, outubro de 2026');
  await form.getByRole('textbox').last().fill('10.000,00');
  await form.locator('input[type="date"]').fill('2026-10-15');
  await shot(form, 'nova-nota');

  await form.getByRole('button', { name: 'Mais opções' }).click();
  await form.getByText('ISS retido pelo cliente').waitFor();
  await shot(form, 'mais-opcoes');

  await form.getByRole('button', { name: 'Revisar' }).click();
  const review = page.locator('main');
  await page.getByRole('button', { name: 'Voltar e editar' }).waitFor();
  await shot(review, 'revisar');
} finally {
  await browser?.close();
  await app?.close();
  close?.();
  await fake.close();
}
