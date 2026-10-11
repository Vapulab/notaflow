export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type BadgeVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export function buttonClasses(
  p: { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg' } = {},
): string {
  const base =
    'inline-flex items-center justify-center font-medium rounded transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50';
  const variant = {
    primary: 'bg-primary text-primary-fg hover:bg-primary/90',
    secondary: 'bg-surface text-fg border border-border hover:bg-muted/10',
    danger: 'bg-danger text-danger-fg hover:bg-danger/90',
  }[p.variant ?? 'primary'];
  const size = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' }[
    p.size ?? 'md'
  ];
  return `${base} ${variant} ${size}`;
}

export function badgeClasses(
  p: { variant?: BadgeVariant; size?: 'sm' | 'md'; outline?: boolean } = {},
): string {
  const base = 'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap';
  const variant = p.variant ?? 'neutral';
  const color = p.outline
    ? {
        neutral: 'border border-border text-fg',
        primary: 'border border-primary text-primary',
        success: 'border border-success text-success',
        warning: 'border border-warning text-warning',
        danger: 'border border-danger text-danger',
        info: 'border border-info text-info',
      }[variant]
    : {
        neutral: 'bg-muted/20 text-fg',
        primary: 'bg-primary text-primary-fg',
        success: 'bg-success text-success-fg',
        warning: 'bg-warning text-warning-fg',
        danger: 'bg-danger text-danger-fg',
        info: 'bg-info text-info-fg',
      }[variant];
  const size = { sm: 'px-2 py-0.5 text-xs', md: 'px-2.5 py-1 text-xs' }[p.size ?? 'md'];
  return `${base} ${color} ${size}`;
}

export function alertClasses(variant: 'info' | 'success' | 'warning' | 'error' = 'info'): string {
  const base = 'flex items-start gap-3 rounded border p-4 text-sm text-fg';
  return `${base} ${
    {
      info: 'border-info/40 bg-info/10',
      success: 'border-success/40 bg-success/10',
      warning: 'border-warning/40 bg-warning/10',
      error: 'border-danger/40 bg-danger/10',
    }[variant]
  }`;
}

export function linkClasses(
  p: { variant?: 'primary' | 'muted' | 'danger'; underline?: boolean } = {},
): string {
  const base = 'rounded-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50';
  const variant = {
    primary: 'text-primary hover:text-primary/80',
    muted: 'text-muted hover:text-fg',
    danger: 'text-danger hover:text-danger/80',
  }[p.variant ?? 'primary'];
  return `${base} ${variant} ${p.underline ? 'underline' : 'hover:underline'}`;
}

export const CARD_CLASSES = 'rounded border border-border bg-surface p-6 shadow-sm';
export const LABEL_CLASSES = 'text-sm font-medium text-fg';
export const INPUT_CLASSES =
  'h-10 px-3 rounded border border-border bg-surface text-fg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';
// Malphas has no file component: the native input keeps its behavior, and its button takes the secondary-button look.
export const FILE_INPUT_CLASSES =
  'block w-full text-sm text-muted file:mr-3 file:h-10 file:cursor-pointer file:rounded file:border file:border-border file:bg-surface file:px-4 file:text-sm file:font-medium file:text-fg file:transition-colors hover:file:bg-muted/10 focus:outline-none focus-visible:file:ring-2 focus-visible:file:ring-primary/50';
export const SELECT_CLASSES =
  'h-10 w-full appearance-none rounded border border-border bg-surface px-3 pr-9 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50';
export const TABLE_CLASSES =
  'w-full border-collapse text-left text-sm [&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-3';
export const THEAD_CLASSES = 'border-b border-border text-xs uppercase tracking-wide text-muted';
export const TBODY_CLASSES = '[&_tr]:border-b [&_tr]:border-border [&_tr:last-child]:border-0';
export const MODAL_PANEL_CLASSES =
  'relative z-10 max-h-full w-full max-w-md overflow-y-auto rounded border border-border bg-surface p-6 shadow-lg focus:outline-none';

// NotaFlow compositions of Malphas tokens, used by every page.
export const SECTION_TITLE_CLASSES = 'mb-3 font-display text-lg font-semibold text-fg';
export const FORM_CLASSES = 'flex flex-col gap-4';
