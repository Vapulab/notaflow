import { type Dispatcher, request } from 'undici';

export type MailKind = 'code' | 'invite' | 'welcome' | 'notice' | 'lifecycle' | 'invoice';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  kind?: MailKind; // what the outbox may retry: a login code is never resent
  replyTo?: string;
  ref?: { accountId: string; invoiceId: string }; // what the invoice e-mail caps count
  headers?: Record<string, string>;
}

export type Mailer = (message: MailMessage) => Promise<void>;

export function resendMailer(options: {
  apiKey: string;
  from: string;
  dispatcher?: Dispatcher;
}): Mailer {
  return async (message) => {
    const response = await request('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: options.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        ...(message.headers ? { headers: message.headers } : {}),
      }),
      ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
    });
    await response.body.dump();
    if (response.statusCode >= 300) {
      throw new Error(`Resend answered ${response.statusCode}`);
    }
  };
}

// Development only: the config refuses to start production without a Resend key.
export function consoleMailer(log: (line: string) => void): Mailer {
  return async (message) => {
    log(`e-mail to ${message.to}: ${message.subject}\n${message.text}`);
  };
}
