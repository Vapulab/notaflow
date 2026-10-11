import { MockAgent } from 'undici';
import { expect, test } from 'vitest';
import { resendMailer } from './mailer';
import { codeEmail, welcomeEmail } from './templates';

const FOOTER = 'Este e-mail é automático e não recebe respostas.';
const message = { to: 'pessoa@example.com', subject: 'Assunto', html: '<p>Oi</p>', text: 'Oi' };

test('resendMailer posts the message to Resend with the key and no reply address', async () => {
  const agent = new MockAgent();
  agent.disableNetConnect();
  type Sent = { headers: Record<string, string>; body: Record<string, unknown> };
  let sent: Sent | null = null;
  agent
    .get('https://api.resend.com')
    .intercept({ path: '/emails', method: 'POST' })
    .reply(200, (options) => {
      sent = {
        headers: options.headers as Record<string, string>,
        body: JSON.parse(String(options.body)) as Record<string, unknown>,
      };
      return { id: 'e1' };
    });
  const mailer = resendMailer({
    apiKey: 're_key',
    from: 'NotaFlow <n@example.com>',
    dispatcher: agent,
  });
  await mailer(message);
  expect(sent).not.toBeNull();
  const { headers, body }: Sent = sent ?? { headers: {}, body: {} };
  expect(headers.authorization).toBe('Bearer re_key');
  expect(body).toEqual({
    from: 'NotaFlow <n@example.com>',
    to: ['pessoa@example.com'],
    subject: 'Assunto',
    html: '<p>Oi</p>',
    text: 'Oi',
  });
});

test('a Resend error names the status and never the key', async () => {
  const agent = new MockAgent();
  agent.disableNetConnect();
  agent
    .get('https://api.resend.com')
    .intercept({ path: '/emails', method: 'POST' })
    .reply(422, { message: 'bad' });
  const mailer = resendMailer({
    apiKey: 're_secret_key',
    from: 'n@example.com',
    dispatcher: agent,
  });
  const error = await mailer(message).catch((e: unknown) => e as Error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain('422');
  expect((error as Error).message).not.toContain('re_secret_key');
});

test.each(['sign-in', 'email-verification', 'forget-password'] as const)(
  'the %s code e-mail holds the code, its validity, and the footer',
  (kind) => {
    const mail = codeEmail(kind, '123456');
    expect(mail.subject).toMatch(/NotaFlow|senha/);
    expect(mail.text).toContain('123456');
    expect(mail.text).toContain('10 minutos');
    expect(mail.text.trim().endsWith(FOOTER)).toBe(true);
    expect(mail.html).toContain('123456');
    expect(mail.html).toContain(FOOTER);
  },
);

test('the welcome e-mail greets by name and escapes it', () => {
  const mail = welcomeEmail('Ana <b>');
  expect(mail.text).toContain('Ana <b>');
  expect(mail.html).toContain('Ana &lt;b&gt;');
  expect(mail.text.trim().endsWith(FOOTER)).toBe(true);
});
