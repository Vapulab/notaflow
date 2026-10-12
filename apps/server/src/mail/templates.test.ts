import { expect, test } from 'vitest';
import { legalChangeEmail } from './templates';

test('the legal change e-mail names the start date of the reminders and links both texts', () => {
  const mail = legalChangeEmail('2026-10-28');
  expect(mail.subject).toBe('Atualizamos os termos de uso e a política de privacidade');
  for (const body of [mail.html, mail.text]) {
    expect(body).toContain('28/10/2026');
    expect(body).toContain('https://notaflow.vapulab.com/termos');
    expect(body).toContain('https://notaflow.vapulab.com/privacidade');
  }
});
