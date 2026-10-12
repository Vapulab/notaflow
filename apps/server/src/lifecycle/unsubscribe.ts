import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MailOutbox } from '../mail/outbox';
import type { AuditLog } from '../repos/AuditLog';
import type { LifecycleRepository } from '../repos/LifecycleRepository';

const PATH = '/lembretes/descadastrar';

// A key of its own, derived from the auth secret, so a token is good for nothing else.
function key(secret: string): Buffer {
  return createHmac('sha256', secret).update('lifecycle-unsubscribe').digest();
}

export function signUnsubscribe(userId: string, secret: string): string {
  return createHmac('sha256', key(secret)).update(userId).digest('base64url');
}

export function unsubscribeUrl(origin: string, userId: string, secret: string): string {
  return `${origin}${PATH}?u=${encodeURIComponent(userId)}&t=${signUnsubscribe(userId, secret)}`;
}

function valid(userId: string, token: string, secret: string): boolean {
  const expected = Buffer.from(signUnsubscribe(userId, secret));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} | NotaFlow</title></head>
<body style="margin:0;padding:24px;background:#fafaf9;color:#090d14;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.5">
<main style="max-width:480px;margin:40px auto;background:#fff;border:1px solid #e2e4e8;border-radius:8px;padding:24px">
<p style="margin:0 0 16px;font-weight:600;font-size:18px;color:#1e40af">NotaFlow</p>
<h1 style="margin:0 0 12px;font-size:20px">${title}</h1>
${body}
</main></body></html>`;
}

const INVALID = page(
  'Link inválido',
  '<p>Este link de descadastro não é válido. Para parar de receber lembretes, entre no NotaFlow e desligue-os no seu perfil, ou escreva para contato@vapulab.com.</p>',
);

// Outside /api: no login and no Origin check, so the link from the e-mail and Gmail's one-click POST both work.
export function registerUnsubscribe(
  app: FastifyInstance,
  deps: { repo: LifecycleRepository; outbox: MailOutbox; audit: AuditLog; secret: string },
): void {
  const userOf = (request: FastifyRequest) => {
    const { u, t } = request.query as { u?: unknown; t?: unknown };
    // A repeated parameter arrives as an array: a bad link, never an error.
    if (typeof u !== 'string' || typeof t !== 'string' || !u || !t) return null;
    if (!valid(u, t, deps.secret)) return null;
    const email = deps.repo.activeEmail(u);
    return email ? { userId: u, email } : null;
  };
  const answer = (reply: FastifyReply, status: number, html: string) =>
    reply
      .status(status)
      .header('x-robots-tag', 'noindex')
      .type('text/html; charset=utf-8')
      .send(html);

  app.register(async (scope) => {
    // Mail providers post "List-Unsubscribe=One-Click" as a form or multipart; only the URL matters.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) =>
      done(null, body),
    );
    scope.get(PATH, async (request, reply) => {
      if (!userOf(request)) return answer(reply, 400, INVALID);
      return answer(
        reply,
        200,
        page(
          'Parar os lembretes por e-mail?',
          `<p>Você não vai mais receber os lembretes sobre o uso do NotaFlow. Os e-mails de serviço, como os códigos de acesso, continuam.</p>
<form method="post"><button type="submit" style="background:#1e40af;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer">Confirmar</button></form>`,
        ),
      );
    });
    scope.post(PATH, async (request, reply) => {
      const user = userOf(request);
      if (!user) return answer(reply, 400, INVALID);
      if (!deps.repo.isOptedOut(user.userId)) {
        deps.repo.setOptOut(user.userId, new Date());
        deps.outbox.cancelPendingLifecycle(user.email);
        deps.audit.record({
          userEmail: user.email,
          accountId: null,
          action: 'lifecycle.opt_out',
          entity: user.userId,
          result: 'ok',
        });
      }
      return answer(
        reply,
        200,
        page(
          'Pronto',
          '<p>Você não vai mais receber lembretes. Para voltar a recebê-los, ligue a opção no seu perfil do NotaFlow.</p>',
        ),
      );
    });
  });
}
