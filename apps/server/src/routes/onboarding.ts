import type { AccountContext } from '@notaflow/core';
import type { FastifyInstance } from 'fastify';
import type { Dispatcher } from 'undici';
import { accountContext, identityOf } from '../auth/guards';
import { municipality } from '../data/places';
import type { Database } from '../db/openDatabase';
import type { EmitterOnboarding } from '../emitters/EmitterOnboarding';
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
  deps: { db: Database; emitterOnboarding: EmitterOnboarding; cnpjDispatcher?: Dispatcher },
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

  // Each lookup reaches public services and may store a card: 10 an hour per account.
  const lookups = new Map<string, number[]>();
  const countLookup = (ctx: AccountContext) => {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const recent = (lookups.get(ctx.accountId) ?? []).filter((at) => at > hourAgo);
    if (recent.length >= 10) throw new HttpError(429, 'too_many_lookups');
    recent.push(Date.now());
    lookups.set(ctx.accountId, recent);
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
      if (identity.memberships.length > 0) throw new HttpError(409, 'already_has_account');
      const accountId = onboarding.createAccount(identity.userId, name);
      if (!accountId) throw new HttpError(409, 'already_has_account');
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

  // Onboarding moves the account through its steps; a finished account adds more emitters the same way.
  for (const [prefix, stepful] of [
    ['/api/accounts/:accountId/onboarding', true],
    ['/api/accounts/:accountId/emitters/new', false],
  ] as const) {
    app.post<Params & { Body: { pdfBase64: string; fileName: string } }>(
      `${prefix}/card`,
      {
        // Room for base64 over 2 MB, so an oversized card gets card_too_large rather than a generic 413.
        bodyLimit: 4 * 1024 * 1024,
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
        atStep(ctx, stepful ? 'card' : 'done');
        const pdf = Buffer.from(request.body.pdfBase64, 'base64');
        if (pdf.length > MAX_CARD_BYTES) throw new HttpError(413, 'card_too_large');
        countLookup(ctx);
        let card;
        try {
          card = await readCard(pdf);
        } catch (error) {
          if (error instanceof CardError) {
            throw new HttpError(error.code === 'card_busy' ? 503 : 422, error.code);
          }
          throw error;
        }
        refuseTaken(ctx, card.cnpj);
        const draft = await lookup(card.cnpj);
        const nameMismatch =
          card.legalName !== null && normalize(card.legalName) !== normalize(draft.legalName);
        const { fileName } = request.body;
        // The step moves first: a parallel upload finds it moved and stores nothing.
        db.transaction(() => {
          if (stepful) move(ctx, 'card', 'certificate');
          // The card waits on the account until the certificate proves the company.
          onboarding.setDraft(ctx, draft, { fileName, content: pdf });
        });
        audit.record({
          userEmail: identityOf(request).email,
          accountId: ctx.accountId,
          action: 'onboarding.card',
          entity: card.cnpj,
          result: 'ok',
          detail: `${draft.source}${nameMismatch ? ', name differs' : ''}`,
        });
        return { draft, nameMismatch, municipalityName: nameOf(draft) };
      },
    );

    app.post<Params & { Body: { cnpj: string } }>(
      `${prefix}/cnpj`,
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
        atStep(ctx, stepful ? 'card' : 'done');
        // Alphanumeric since 2026: twelve [0-9A-Z] and two check digits.
        const cnpj = request.body.cnpj.toUpperCase().replace(/[./-\s]/g, '');
        if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj)) throw new HttpError(400, 'invalid_cnpj');
        countLookup(ctx);
        refuseTaken(ctx, cnpj);
        const draft = await lookup(cnpj);
        db.transaction(() => {
          if (stepful) move(ctx, 'card', 'certificate');
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
        return { draft, nameMismatch: false, municipalityName: nameOf(draft) };
      },
    );

    app.post<
      Params & {
        Body: {
          pfxBase64: string;
          password: string;
          municipalRegistration?: string;
          advanced?: {
            simplesRegime?: '1' | '2' | '3';
            specialRegime?: string;
            dpsSeries?: string;
          };
        };
      }
    >(
      `${prefix}/certificate`,
      {
        schema: {
          body: {
            type: 'object',
            required: ['pfxBase64', 'password'],
            additionalProperties: false,
            properties: {
              pfxBase64: { type: 'string', minLength: 1, maxLength: 200_000 },
              password: { type: 'string', maxLength: 200 },
              municipalRegistration: { type: 'string', minLength: 1, maxLength: 15 },
              advanced: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  simplesRegime: { enum: ['1', '2', '3'] },
                  specialRegime: { enum: ['0', '1', '2', '3', '4', '5', '6', '9'] },
                  dpsSeries: { type: 'string', pattern: '^[0-9]{1,5}$' },
                },
              },
            },
          },
        },
      },
      async (request, reply) => {
        const ctx = accountContext(request, request.params.accountId, { owner: true, write: true });
        atStep(ctx, stepful ? 'certificate' : 'done');
        const draft = onboarding.draft(ctx);
        if (!draft) throw new HttpError(409, 'card_required');
        const { pfxBase64, password, municipalRegistration, advanced = {} } = request.body;
        const emitter = await deps.emitterOnboarding.create(
          ctx,
          identityOf(request).email,
          {
            pfxBase64,
            password,
            municipality: draft.municipality,
            ...(municipalRegistration ? { municipalRegistration } : {}),
            simplesNacional: draft.simplesNacional,
            ...(draft.simplesNacional === '3'
              ? { simplesRegime: advanced.simplesRegime ?? '1' }
              : {}),
            specialRegime: advanced.specialRegime ?? '0',
            dpsSeries: advanced.dpsSeries ?? '900',
            cnaes: [...(draft.cnae ? [draft.cnae] : []), ...(draft.secondaryCnaes ?? [])],
          },
          {
            expectedCnpj: draft.cnpj,
            // With the emitter's insert: the step moves, the proven card is kept, and the draft goes.
            inTransaction: () => {
              // Only an ME or EPP in the Simples has an annex and a band to set.
              if (stepful)
                move(ctx, 'certificate', draft.simplesNacional === '3' ? 'fiscal' : 'sync');
              const card = onboarding.draftCard(ctx);
              if (card) documents.addCnpjCard(ctx, { cnpj: draft.cnpj, ...card });
              // Onboarding keeps the draft for the fiscal step; another emitter has none.
              onboarding.setDraft(ctx, stepful ? draft : null);
            },
          },
        );
        return reply.status(201).send(emitter);
      },
    );
  }

  app.get<Params>('/api/accounts/:accountId/onboarding', async (request) => {
    const ctx = accountContext(request, request.params.accountId);
    const draft = onboarding.draft(ctx);
    return { step: onboarding.step(ctx), draft, municipalityName: draft ? nameOf(draft) : null };
  });

  // "Trocar cartão": the confirmed data was not this company's; the card step runs again.
  app.post<Params>('/api/accounts/:accountId/onboarding/back-to-card', async (request) => {
    const ctx = accountContext(request, request.params.accountId, { owner: true, write: true });
    return db.transaction(() => {
      const moved = move(ctx, 'certificate', 'card');
      onboarding.setDraft(ctx, null);
      return moved;
    });
  });

  app.post<Params>('/api/accounts/:accountId/onboarding/fiscal-done', async (request) => {
    const ctx = accountContext(request, request.params.accountId, { owner: true, write: true });
    return db.transaction(() => {
      const moved = move(ctx, 'fiscal', 'sync');
      onboarding.setDraft(ctx, null);
      return moved;
    });
  });

  app.post<Params>('/api/accounts/:accountId/onboarding/finish', async (request) => {
    const ctx = accountContext(request, request.params.accountId, { owner: true, write: true });
    return db.transaction(() => {
      const moved = move(ctx, 'sync', 'done');
      onboarding.setDraft(ctx, null);
      return moved;
    });
  });
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

function nameOf(draft: CnpjDraft): string | null {
  return municipality(draft.municipality)?.name ?? null;
}
