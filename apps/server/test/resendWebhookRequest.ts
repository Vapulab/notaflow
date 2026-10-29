import { createHmac } from 'node:crypto';
import { RESEND_WEBHOOK_PATH } from '../src/mail/resendWebhook';
import type { TestApp } from './testApp';

export const WEBHOOK_KEY = Buffer.alloc(32, 5);
export const WEBHOOK_SECRET = `whsec_${WEBHOOK_KEY.toString('base64')}`;

export function signWebhook(
  id: string,
  timestamp: string,
  body: string,
  key = WEBHOOK_KEY,
): string {
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
}

// A Resend webhook request, signed with WEBHOOK_SECRET unless the headers say otherwise.
export function postWebhook(
  app: TestApp,
  body: string,
  headers: { id?: string; timestamp?: string; signature?: string } = {},
) {
  const id = headers.id ?? 'msg_1';
  const timestamp = headers.timestamp ?? String(Math.floor(Date.now() / 1000));
  return app.app.inject({
    method: 'POST',
    url: RESEND_WEBHOOK_PATH,
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': headers.signature ?? `v1,${signWebhook(id, timestamp, body)}`,
    },
    payload: body,
  });
}
