import type { AccountContext } from '@notaflow/core';
import type { FastifyInstance } from 'fastify';
import type { Dispatcher } from 'undici';
import { accountContext, identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import { CardError, MAX_CARD_BYTES, readCard } from '../onboarding/cardReader';
import { LookupError, lookupCnpj } from '../onboarding/cnpjLookup';
import type { CnpjDraft, OnboardingStep } from '../onboarding/types';
import { AccountDocumentRepository } from '../repos/AccountDocumentRepository';
import { AuditLog } from '../repos/AuditLog';
import { EmitterRepository } from '../repos/EmitterRepository';
import { OnboardingRepository } from '../repos/OnboardingRepository';

type Params = { Params: { accountId: string } };

export function onboardingRoutes(
  app: FastifyInstance,
  deps: { db: Database; cnpjDispatcher?: Dispatcher },
): void {
  const { db } = deps;
  const onboarding = new OnboardingRepository(db);
  const documents = new AccountDocumentRepository(db);
  const emitters = new EmitterRepository(db);
  const audit = new AuditLog(db);

  // The same refusals as the emitter creation, before anything is looked up or stored.
  const refuseTaken = (ctx: AccountContext, cnpj: string) => {
    if (emitters.isCnpjOfRemovedEmitter(ctx, cnpj)) throw new HttpError(409, 'emitter_removed');
    if (emitters.isCnpjTakenElsewhere(ctx, cnpj)) throw new HttpError(409, 'cnpj_in_other_account');
    if (emitters.findByCnpj(ctx, cnpj)) throw new HttpError(409, 'emitter_exists');
  };

  const lookup = async (cnpj: string): Promise<CnpjDraft> => {
    try {
      return await lookupCnpj(cnpj, deps.cnpjDispatcher ? { dispatcher: deps.cnpjDispatcher } : {});
    } catch (error) {
      if (!(error instanceof LookupError)) throw error;
      if (error.code === 'cnpj_lookup_unavailable') throw new HttpError(502, error.code);
      throw new HttpError(422, error.code, undefined, error.status ? { status: error.status } : {});
    }
  };

  const atStep = (ctx: AccountContext, step: OnboardingStep) => {
    const current = onboarding.step(ctx);
    if (current !== step) throw new HttpError(409, 'onboarding_step', undefined, { step: current });
  };

  // Moves one step, or answers which step the account is really at.
  const move = (ctx: AccountContext, from: OnboardingStep, to: OnboardingStep) => {
    if (!onboarding.advance(ctx, from, to)) {
      throw new HttpError(409, 'onboarding_step', undefined, { step: onboarding.step(ctx) });
    }
    return { step: to };
  };

  app.post<{ Body: { name: string } }>(
    '/api/onboarding/account',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: { name: { type: 'string', minLength: 1, maxLength: 120 } },
        },
      },
    },
    async (request, reply) => {
      const identity = identityOf(request);
      const name = request.body.name.trim();
      if (!name) throw new HttpError(400, 'invalid_name');
      // One account per signup; joining more accounts is by invitation.
      if (identity.memberships.length > 0) throw new HttpError(409, 'already_member');
      const accountId = onboarding.createAccount(identity.userId, name);
      audit.record({
        userEmail: identity.email,
        accountId,
        action: 'account.create',
        entity: accountId,
        result: 'ok',
        detail: 'onboarding',
      });
      return reply.status(201).send({ accountId });
    },
  );

  app.post<Params & { Body: { pdfBase64: string; fileName: string } }>(
    '/api/accounts/:accountId/onboarding/card',
    {
      // A 2 MB card is about 2.7 MB in base64; the decoded size is checked below.
      bodyLimit: 3 * 1024 * 1024,
      schema: {
        body: {
          type: 'object',
          required: ['pdfBase64', 'fileName'],
          additionalProperties: false,
          properties: {
            pdfBase64: { type: 'string', minLength: 1 },
            fileName: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request) => {
      const ctx = accountContext(request, request.params.accountId, { owner: true, write: true });
      atStep(ctx, 'card');
      const pdf = Buffer.from(request.body.pdfBase64, 'base64');
      if (pdf.length > MAX_CARD_BYTES) throw new HttpError(413, 'card_too_large');
      let card;
      try {
        card = await readCard(pdf);
      } catch (error) {
        if (error instanceof CardError) throw new HttpError(422, error.code);
        throw error;
      }
      refuseTaken(ctx, card.cnpj);
      const draft = await lookup(card.cnpj);
      const nameMismatch =
        card.legalName !== null && normalize(card.legalName) !== normalize(draft.legalName);
      const { fileName } = request.body;
      const cnpj = card.cnpj;
      // The step moves first: a parallel upload finds it moved and stores nothing.
      db.transaction(() => {
        move(ctx, 'card', 'certificate');
        documents.addCnpjCard(ctx, { cnpj, fileName, content: pdf });
        onboarding.setDraft(ctx, draft);
      });
      audit.record({
        userEmail: identityOf(request).email,
        accountId: ctx.accountId,
        action: 'onboarding.card',
        entity: card.cnpj,
        result: 'ok',
        detail: `${draft.source}${nameMismatch ? ', name differs' : ''}`,
      });
      return { draft, nameMismatch };
    },
  );

  app.post<Params & { Body: { cnpj: string } }>(
    '/api/accounts/:accountId/onboarding/cnpj',
    {
      schema: {
        body: {
          type: 'object',
          required: ['cnpj'],
          additionalProperties: false,
          properties: { cnpj: { type: 'string', minLength: 14, maxLength: 18 } },
        },
      },
    },
    async (request) => {
      const ctx = accountContext(request, request.params.accountId, { owner: true, write: true });
      atStep(ctx, 'card');
      const cnpj = request.body.cnpj.replace(/[./-]/g, '');
      if (!/^\d{14}$/.test(cnpj)) throw new HttpError(400, 'invalid_cnpj');
      refuseTaken(ctx, cnpj);
      const draft = await lookup(cnpj);
      db.transaction(() => {
        move(ctx, 'card', 'certificate');
        onboarding.setDraft(ctx, draft);
      });
      audit.record({
        userEmail: identityOf(request).email,
        accountId: ctx.accountId,
        action: 'onboarding.card',
        entity: cnpj,
        result: 'ok',
        detail: `${draft.source}, typed`,
      });
      return { draft, nameMismatch: false };
    },
  );

  app.get<Params>('/api/accounts/:accountId/onboarding', async (request) => {
    const ctx = accountContext(request, request.params.accountId);
    return { step: onboarding.step(ctx), draft: onboarding.draft(ctx) };
  });

  app.post<Params>('/api/accounts/:accountId/onboarding/fiscal-done', async (request) =>
    move(
      accountContext(request, request.params.accountId, { owner: true, write: true }),
      'fiscal',
      'sync',
    ),
  );

  app.post<Params>('/api/accounts/:accountId/onboarding/finish', async (request) =>
    move(
      accountContext(request, request.params.accountId, { owner: true, write: true }),
      'sync',
      'done',
    ),
  );
}

// Case, accents, and punctuation differ between the card and the lookup; the words do not.
function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}
