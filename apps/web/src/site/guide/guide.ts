import '../site';
import './guide.css';
import { track } from '../../analytics/analytics';
import { mountCnpjCheck } from './cnpjCheck';
import { mountWaitlist } from './waitlist';

for (const card of document.querySelectorAll<HTMLAnchorElement>('a[data-guide-path]')) {
  card.addEventListener('click', () => track('guide_path', { path: card.dataset.guidePath ?? '' }));
}
for (const root of document.querySelectorAll<HTMLElement>('[data-cnpj-check]')) {
  mountCnpjCheck(root);
  // The "Não sei" card is not a link: its choice is the first use of the CNPJ field.
  root.addEventListener('focusin', () => track('guide_path', { path: 'nao_sei' }), { once: true });
}
for (const form of document.querySelectorAll<HTMLFormElement>('form[data-waitlist]'))
  mountWaitlist(form);
