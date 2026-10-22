import { track } from '../../analytics/analytics';
import { campaignOf } from '../../analytics/source';
import { loadTurnstile } from '../../auth/turnstileScript';
import { buttonClasses, INPUT_CLASSES, LABEL_CLASSES } from '../../ui/classes';
import { publicConfig } from '../publicConfig';
import { h, TOO_MANY } from './dom';

const INTERESTS = [
  ['mei', 'Emitir como MEI'],
  ['lucro_presumido', 'Emitir no Lucro Presumido'],
  ['certificate', 'Comprar o certificado pelo NotaFlow'],
] as const;

const ERRORS: Record<number, string> = {
  400: 'Confira o e-mail e tente de novo.',
  403: 'Não conseguimos confirmar o envio. Recarregue a página e tente de novo.',
  429: TOO_MANY,
};
const FAILED = 'Não foi possível enviar agora. Tente de novo mais tarde.';

// One notify-me form per page; the page's own interest comes checked.
export function mountWaitlist(form: HTMLFormElement): void {
  const pageInterest = form.dataset.interest;
  const id = `waitlist-${pageInterest ?? 'form'}`;
  const email = h('input', {
    id: `${id}-email`,
    type: 'email',
    name: 'email',
    autocomplete: 'email',
    required: true,
    class: `${INPUT_CLASSES} w-full`,
  });
  const boxes = INTERESTS.map(([value, label]) => {
    const box = h('input', { type: 'checkbox', name: 'interests', value, class: 'h-4 w-4' });
    box.checked = value === pageInterest;
    return h('label', { class: 'flex items-center gap-2 text-sm text-fg' }, box, label);
  });
  const captcha = h('div');
  const button = h('button', { type: 'submit', class: buttonClasses() }, 'Quero ser avisado');
  const status = h('div', { role: 'status', class: 'text-sm text-fg' });
  form.classList.add('mt-4', 'flex', 'flex-col', 'gap-3');
  form.noValidate = true;
  form.replaceChildren(
    h('label', { for: `${id}-email`, class: LABEL_CLASSES }, 'Seu e-mail'),
    email,
    h(
      'fieldset',
      { class: 'flex flex-col gap-2' },
      h('legend', { class: LABEL_CLASSES }, 'Quero saber quando der para:'),
      ...boxes,
    ),
    captcha,
    button,
    h(
      'p',
      { class: 'text-xs text-muted' },
      'Usamos seu e-mail só para avisar sobre isso. ',
      h('a', { href: '/privacidade' }, 'Política de privacidade'),
      '.',
    ),
    status,
  );

  let token: string | null = null;
  let siteKey: string | null = null;
  void publicConfig().then((config) => {
    siteKey = config?.turnstileSiteKey ?? null;
    if (!siteKey) return;
    const key = siteKey;
    loadTurnstile().then(
      (api) =>
        api.render(captcha, {
          sitekey: key,
          callback: (value) => (token = value),
          'expired-callback': () => (token = null),
          'error-callback': () => (token = null),
          theme: 'auto',
          language: 'pt-br',
        }),
      () => (token = null),
    );
  });

  const show = (text: string, error: boolean) =>
    status.replaceChildren(h('p', { class: error ? 'nf-text-danger' : '' }, text));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const interests = boxes
      .map((label) => label.querySelector('input'))
      .filter((box): box is HTMLInputElement => box?.checked === true)
      .map((box) => box.value);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()))
      return show('Informe um e-mail válido.', true);
    if (interests.length === 0) return show('Escolha pelo menos um aviso.', true);
    if (siteKey && !token) return show('Confirme que você não é um robô.', true);
    const campaign = campaignOf(window.location.search);
    const body = {
      email: email.value.trim(),
      interests,
      sourcePage: window.location.pathname,
      ...(campaign ? { campaign } : {}),
      ...(token ? { turnstileToken: token } : {}),
    };
    button.disabled = true;
    status.replaceChildren();
    void fetch('/api/public/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((response) => {
        if (!response.ok) return show(ERRORS[response.status] ?? FAILED, true);
        track('waitlist_signup', {
          interests: interests.join(','),
          page: window.location.pathname,
        });
        show('Pronto! Avisamos você por e-mail quando estiver pronto.', false);
      })
      .catch(() => show(FAILED, true))
      .finally(() => {
        button.disabled = false;
      });
  });
}
