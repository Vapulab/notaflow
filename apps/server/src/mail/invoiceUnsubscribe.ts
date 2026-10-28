import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { page } from '../lifecycle/unsubscribe';
import type { MailSuppressionRepository } from '../repos/MailSuppressionRepository';
import { isEmailAddress } from './address';

const PATH = '/nota/descadastrar';

// A key of its own, derived from the auth secret, so a token is good for nothing else.
function key(secret: string): Buffer {
  return createHmac('sha256', secret).update('invoice-unsubscribe').digest();
}

const normal = (address: string) => address.trim().toLowerCase();

export function signInvoiceUnsubscribe(address: string, secret: string): string {
  return createHmac('sha256', key(secret)).update(normal(address)).digest('base64url');
}

export function invoiceUnsubscribeUrl(origin: string, address: string, secret: string): string {
  return `${origin}${PATH}?a=${encodeURIComponent(normal(address))}&t=${signInvoiceUnsubscribe(address, secret)}`;
}

function valid(address: string, token: string, secret: string): boolean {
  const expected = Buffer.from(signInvoiceUnsubscribe(address, secret));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const INVALID = page(
  'Link inválido',
  '<p>Este link de descadastro não é válido. Para parar de receber estes e-mails, escreva para contato@vapulab.com.</p>',
);

// Outside /api: no login and no Origin check, so the link from the e-mail and the mail client's one-click POST both work.
export function registerInvoiceUnsubscribe(
  app: FastifyInstance,
  deps: { suppressions: MailSuppressionRepository; secret: string },
): void {
  const addressOf = (request: FastifyRequest) => {
    const { a, t } = request.query as { a?: unknown; t?: unknown };
    if (typeof a !== 'string' || typeof t !== 'string' || !a || !t) return null;
    return isEmailAddress(a) && valid(a, t, deps.secret) ? normal(a) : null;
  };
  const answer = (reply: FastifyReply, status: number, html: string) =>
    reply
      .status(status)
      .header('x-robots-tag', 'noindex')
      .header('cache-control', 'private, no-store')
      .type('text/html; charset=utf-8')
      .send(html);

  app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) =>
      done(null, body),
    );
    scope.get(PATH, async (request, reply) => {
      if (!addressOf(request)) return answer(reply, 400, INVALID);
      return answer(
        reply,
        200,
        page(
          'Parar de receber notas por e-mail?',
          `<p>Você não vai mais receber por e-mail os links de notas fiscais enviados pelo NotaFlow neste endereço. Quem emitiu a nota ainda pode entregá-la por outro meio.</p>
<form method="post"><button type="submit" style="background:#1e40af;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer">Confirmar</button></form>`,
        ),
      );
    });
    scope.post(PATH, async (request, reply) => {
      const address = addressOf(request);
      if (!address) return answer(reply, 400, INVALID);
      deps.suppressions.add(address, 'invoice');
      return answer(
        reply,
        200,
        page(
          'Pronto',
          '<p>Você não vai mais receber por e-mail os links de notas fiscais do NotaFlow neste endereço.</p>',
        ),
      );
    });
  });
}
