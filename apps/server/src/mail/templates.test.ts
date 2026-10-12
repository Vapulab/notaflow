import { expect, test } from 'vitest';
import { legalChangeEmail, lifecycleEmail, welcomeEmail } from './templates';

test('the legal change e-mail names the start date of the reminders and links both texts', () => {
  const mail = legalChangeEmail('2026-10-28');
  expect(mail.subject).toBe('Atualizamos os termos de uso e a política de privacidade');
  for (const body of [mail.html, mail.text]) {
    expect(body).toContain('28/10/2026');
    expect(body).toContain('https://notaflow.vapulab.com/termos');
    expect(body).toContain('https://notaflow.vapulab.com/privacidade');
  }
});

const CASES = [
  ['activation', 1, 'card', 'Falta só o cartão CNPJ'],
  ['activation', 2, 'card', 'Precisa de ajuda com o cadastro?'],
  ['activation', 1, 'certificate', 'Falta o certificado digital A1'],
  ['activation', 2, 'certificate', 'Seu certificado A1 já chegou?'],
  ['activation', 1, 'fiscal', 'Último passo: a receita dos últimos 12 meses'],
  ['activation', 2, 'fiscal', 'Sua conta está quase pronta'],
  ['activation', 1, 'finish', 'Falta só concluir o cadastro'],
  ['activation', 2, 'finish', 'Sua conta está a um passo de emitir'],
  ['first_invoice', 1, '', 'Tudo pronto para a sua primeira nota'],
  ['first_invoice', 2, '', 'Sua primeira nota pelo NotaFlow'],
  ['reactivation', 1, '', 'Suas notas continuam aqui'],
  ['reactivation', 2, '', 'Ainda emitindo notas de serviço?'],
] as const;

// The app routes an e-mail may link to (apps/web/src/router.ts).
const ROUTES = [
  /^\/app$/,
  /^\/app\/comecar\/acc-1$/,
  /^\/app\/acc-1\/notas\/nova$/,
  /^\/termos$/,
  /^\/privacidade$/,
];
const appLinks = (body: string) =>
  [...body.matchAll(/https:\/\/notaflow\.vapulab\.com(\/[^\s"<)]*)/g)].map((m) => m[1] ?? '');

test.each(CASES)(
  '%s %s %s: subject, links, reply-to, and opt-out',
  (phase, step, variant, subject) => {
    const unsubscribeUrl = 'https://notaflow.vapulab.com/lembretes/descadastrar?u=u1&t=tok';
    const mail = lifecycleEmail({
      phase,
      step,
      variant,
      name: '<Ana>',
      accountId: 'acc-1',
      unsubscribeUrl,
    });
    expect(mail.subject).toBe(subject);
    expect(mail.replyTo).toBe('contato@vapulab.com');
    expect(mail.headers).toEqual({
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    for (const body of [mail.html, mail.text]) {
      expect(body).toContain('/lembretes/descadastrar?u=u1');
      expect(body).not.toContain('não recebe respostas');
      for (const link of appLinks(body).filter((l) => !l.startsWith('/lembretes'))) {
        expect(
          ROUTES.some((r) => r.test(link)),
          link,
        ).toBe(true);
      }
    }
    expect(mail.html).toContain('&lt;Ana&gt;');
    expect(mail.html).not.toContain('<Ana>');
    const words = mail.text.split(/\s+/).length;
    expect(words, 'words').toBeGreaterThan(40);
    expect(words, 'words').toBeLessThan(200);
  },
);

test('the welcome e-mail is a guide to the first invoice, with no opt-out link', () => {
  const mail = welcomeEmail('Ana');
  expect(mail.subject).toBe('Boas-vindas ao NotaFlow: sua primeira nota em 4 passos');
  for (const step of ['cartão CNPJ', 'certificado', 'receita', 'Emitir'])
    expect(mail.text).toContain(step);
  expect(mail.html).toContain('https://notaflow.vapulab.com/app');
  expect(mail.text).not.toContain('descadastr');
});
