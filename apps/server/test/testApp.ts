import type { AccountContext } from '@notaflow/core';
import { type FakeNacional, startFakeNacional } from '@notaflow/fake-nacional';
import type { FastifyInstance } from 'fastify';
import type { Dispatcher } from 'undici';
import type { ExchangeRateSource } from '../src/exchange/ptax';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { buildApp } from '../src/app';
import { createAccessVerifier } from '../src/auth/accessVerifier';
import { nacionalIssuerFactory } from '../src/providers/providerFactory';
import { loadConfig } from '../src/config';
import { type Database, openDatabase } from '../src/db/openDatabase';

export const ORIGIN = 'http://localhost:3000';
const ISSUER = 'https://test.cloudflareaccess.com';
const AUDIENCE = 'test-aud';

export interface TestApp {
  app: FastifyInstance;
  db: Database;
  fake: FakeNacional;
  tokenFor(email: string): Promise<string>;
  as(email: string): Promise<Record<string, string>>;
  close(): Promise<void>;
}

export async function createTestApp(
  options: {
    logStream?: { write(line: string): void };
    onEmitterCreated?: (ctx: AccountContext, emitterId: string) => void;
    ptaxDispatcher?: Dispatcher;
    exchangeRate?: ExchangeRateSource;
  } = {},
): Promise<TestApp> {
  const fake = await startFakeNacional();
  const { db, close } = openDatabase(':memory:');
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256' }] });
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    APP_ORIGIN: ORIGIN,
    NFSE_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    AUTH_MODE: 'access',
    CF_ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com',
    CF_ACCESS_AUD: AUDIENCE,
    NACIONAL_FAKE_URL: fake.urls.sefin.replace('/SefinNacional', ''),
  });
  const app = buildApp({
    config,
    db,
    verifyAccessToken: createAccessVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks }),
    ...(options.logStream ? { logStream: options.logStream } : {}),
    ...(options.ptaxDispatcher ? { ptaxDispatcher: options.ptaxDispatcher } : {}),
    // A fixed PTAX of 5.0000 unless a test brings its own; the real one is a network call.
    exchangeRate:
      options.exchangeRate ??
      (async (currency, date) => ({
        currency,
        date,
        rateE4: 50_000,
        source: 'PTAX venda, fechamento',
      })),
    // Tests sync explicitly; a background sync could outlive the in-memory database.
    onEmitterCreated: options.onEmitterCreated ?? (() => {}),
    // Production waits 1, 5, and 15 seconds; a test would hit its own timeout.
    syncRetryDelaysMs: [0, 0],
    // A short Sefin timeout, so the fake's delay scenario turns into an uncertain result.
    issuerFactory: nacionalIssuerFactory(config.nacionalUrls, 300),
  });
  await app.ready();

  const tokenFor = (email: string) =>
    new SignJWT({ email })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

  return {
    app,
    db,
    fake,
    tokenFor,
    as: async (email) => ({
      'cf-access-jwt-assertion': await tokenFor(email),
      origin: ORIGIN,
      'content-type': 'application/json',
    }),
    close: async () => {
      await app.close();
      close();
      await fake.close();
    },
  };
}
