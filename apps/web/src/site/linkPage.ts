import { track } from '../analytics/analytics';
import { formatCents, formatDate } from '../format';

interface LinkSummary {
  emitterName: string;
  number: string;
  issuedAt: string;
  netCents: number;
  notice: 'cancelada' | 'substituida' | null;
  testEnvironment: boolean;
}

const NOTICES = {
  cancelada: 'Esta nota foi cancelada.',
  substituida: 'Esta nota foi substituída.',
};

const BUTTON =
  'inline-flex h-11 items-center justify-center rounded px-5 font-medium focus:outline-none focus:ring-2 focus:ring-primary/50';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(className: string, href: string, text: string): HTMLAnchorElement {
  const anchor = el('a', className, text);
  anchor.rel = 'noreferrer';
  anchor.href = href;
  return anchor;
}

function renderInvalid(root: HTMLElement): void {
  root.replaceChildren(
    el('h1', 'font-display text-2xl font-semibold', 'Link inválido ou removido.'),
    link(
      `${BUTTON} mt-6 bg-primary text-primary-fg hover:bg-primary/90`,
      '/',
      'Ir para o NotaFlow',
    ),
  );
}

function renderUnavailable(root: HTMLElement): void {
  root.replaceChildren(
    el('h1', 'font-display text-2xl font-semibold', 'Não foi possível carregar a nota agora.'),
    el('p', 'mt-3 text-muted', 'Tente de novo em alguns minutos.'),
  );
}

function renderSummary(root: HTMLElement, token: string, origin: string, data: LinkSummary): void {
  const card = el('section', 'rounded border border-border p-5');
  if (data.testEnvironment) {
    card.append(
      el(
        'p',
        'mb-3 inline-block rounded bg-warning px-2 py-1 text-xs font-semibold text-warning-fg',
        'SEM VALIDADE JURÍDICA',
      ),
    );
  }
  card.append(
    el('p', 'text-sm text-muted', data.emitterName),
    el('h1', 'mt-1 font-display text-2xl font-semibold', `NFS-e nº ${data.number}`),
    el('p', 'mt-3 text-sm text-muted', `Emitida em ${formatDate(data.issuedAt)}`),
    el('p', 'mt-1 text-sm text-muted', 'Valor líquido'),
    el('p', 'font-display text-3xl font-semibold', formatCents(data.netCents)),
  );
  if (data.notice) {
    const notice = el(
      'p',
      'mt-4 rounded border border-border p-3 font-medium',
      NOTICES[data.notice],
    );
    notice.setAttribute('role', 'status');
    card.append(notice);
  }
  card.append(
    link(
      `${BUTTON} mt-5 w-full bg-primary text-primary-fg hover:bg-primary/90 sm:w-auto`,
      `/api/public/n/${token}/pdf`,
      'Baixar PDF',
    ),
  );

  const campaign = `${origin}/?utm_source=danfse_link&utm_medium=referral&utm_campaign=nota`;
  const promo = el(
    'section',
    'mt-8 flex flex-col gap-4 rounded border border-border p-5 sm:flex-row sm:items-center',
  );
  const qr = el('div', 'h-28 w-28 shrink-0 text-fg');
  qr.dataset.qr = '';
  const pitch = el('div', 'flex-1');
  pitch.append(
    el('p', 'font-medium', 'Emita suas NFS-e em segundos com o NotaFlow.'),
    link(
      `${BUTTON} mt-3 border border-border text-fg hover:bg-muted/10`,
      campaign,
      'Conhecer o NotaFlow',
    ),
  );
  promo.append(pitch, qr);
  root.replaceChildren(card, promo);

  // The QR library loads after the page shows; a failure leaves the button.
  void import('qrcode')
    .then(({ default: QRCode }) => QRCode.toString(campaign, { type: 'svg', margin: 0 }))
    .then((svg) => {
      qr.innerHTML = svg;
      qr.querySelector('svg')?.setAttribute('role', 'img');
      qr.querySelector('svg')?.setAttribute('aria-label', 'QR code para conhecer o NotaFlow');
    })
    .catch(() => undefined);
}

export async function mountLinkPage(
  root: HTMLElement,
  token: string,
  origin: string,
): Promise<void> {
  let data: LinkSummary | null = null;
  try {
    const response = await fetch(`/api/public/n/${token}`);
    if (response.status === 404) return renderInvalid(root);
    if (response.ok) data = (await response.json()) as LinkSummary;
  } catch {
    // Falls through to the retry message.
  }
  if (!data) return renderUnavailable(root);
  renderSummary(root, token, origin, data);
  track('danfse_link_viewed');
}
