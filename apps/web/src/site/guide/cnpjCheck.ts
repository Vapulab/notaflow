import { track } from '../../analytics/analytics';
import { buttonClasses, INPUT_CLASSES, LABEL_CLASSES } from '../../ui/classes';
import { h, TOO_MANY } from './dom';

type Regime = 'mei' | 'simples' | 'other' | 'inactive';

const PATHS: Record<Regime, { text: string; link?: string; href?: string }> = {
  mei: {
    text: 'Sua empresa é MEI.',
    link: 'Veja o caminho do MEI',
    href: '/guia/mei',
  },
  simples: {
    text: 'Sua empresa é do Simples Nacional.',
    link: 'Veja o caminho do Simples Nacional',
    href: '/guia/simples-nacional',
  },
  other: {
    text: 'Sua empresa não é do Simples Nacional. Pode ser Lucro Presumido ou Lucro Real: confirme com seu contador.',
    link: 'Veja o caminho do Lucro Presumido',
    href: '/guia/lucro-presumido',
  },
  inactive: {
    text: 'Este CNPJ não está ativo na Receita. Confira o número ou fale com seu contador.',
  },
};

const ERRORS: Record<number, string> = {
  400: 'CNPJ inválido. Confira os números.',
  404: 'Não encontramos esse CNPJ na Receita Federal. Confira os números.',
  429: TOO_MANY,
};
const UNAVAILABLE = 'A consulta não está disponível agora. Tente de novo em alguns minutos.';

const isRegime = (value: unknown): value is Regime =>
  value === 'mei' || value === 'simples' || value === 'other' || value === 'inactive';

export function mountCnpjCheck(root: HTMLElement): void {
  const input = h('input', {
    id: 'cnpj-check',
    name: 'cnpj',
    class: `${INPUT_CLASSES} w-full`,
    inputmode: 'text',
    autocomplete: 'off',
    placeholder: '00.000.000/0000-00',
    required: true,
  });
  const button = h('button', { type: 'submit', class: buttonClasses() }, 'Ver meu caminho');
  const status = h('div', { role: 'status', class: 'text-sm text-fg' });
  const form = h(
    'form',
    { class: 'mt-3 flex flex-col gap-2', novalidate: true },
    h('label', { for: 'cnpj-check', class: LABEL_CLASSES }, 'CNPJ da empresa'),
    input,
    button,
    status,
  );
  root.replaceChildren(form);

  const show = (...children: (Node | string)[]) => status.replaceChildren(...children);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const cnpj = input.value.replace(/[.\-/\s]/g, '').toUpperCase();
    if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj)) {
      show(h('p', { class: 'nf-text-danger' }, ERRORS[400] ?? ''));
      return;
    }
    button.disabled = true;
    button.textContent = 'Consultando...';
    show();
    void fetch(`/api/public/cnpj-regime/${cnpj}`)
      .then(async (response) => {
        const body: unknown = response.ok ? await response.json() : null;
        const regime = (body as { regime?: unknown } | null)?.regime;
        if (!isRegime(regime)) {
          show(h('p', { class: 'nf-text-danger' }, ERRORS[response.status] ?? UNAVAILABLE));
          return;
        }
        track('guide_cnpj_regime', { result: regime });
        const path = PATHS[regime];
        show(
          path.link && path.href
            ? h('p', {}, path.text, ' ', h('a', { href: path.href }, path.link), '.')
            : h('p', {}, path.text),
        );
      })
      .catch(() => show(h('p', { class: 'nf-text-danger' }, UNAVAILABLE)))
      .finally(() => {
        button.disabled = false;
        button.textContent = 'Ver meu caminho';
      });
  });
}
