import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
  Ref,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';
import {
  alertClasses,
  type BadgeVariant,
  badgeClasses,
  type ButtonVariant,
  buttonClasses,
  CARD_CLASSES,
  linkClasses,
  TABLE_CLASSES,
  TBODY_CLASSES,
  THEAD_CLASSES,
} from './classes';

const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' ');

export function Button({
  variant,
  size,
  className,
  type,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <button
      {...rest}
      type={type ?? 'button'}
      className={join(
        buttonClasses({ ...(variant ? { variant } : {}), ...(size ? { size } : {}) }),
        className,
      )}
    />
  );
}

export function Badge({
  variant,
  size,
  outline,
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  outline?: boolean;
}) {
  return (
    <span
      {...rest}
      className={join(
        badgeClasses({
          ...(variant ? { variant } : {}),
          ...(size ? { size } : {}),
          ...(outline ? { outline } : {}),
        }),
        className,
      )}
    />
  );
}

export function Alert({
  variant,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { variant?: 'info' | 'success' | 'warning' | 'error' }) {
  return <div {...rest} role="alert" className={join(alertClasses(variant), className)} />;
}

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={join(CARD_CLASSES, className)} />;
}

export function Link({
  variant,
  underline,
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: 'primary' | 'muted' | 'danger';
  underline?: boolean;
}) {
  return (
    <a
      {...rest}
      className={join(
        linkClasses({ ...(variant ? { variant } : {}), ...(underline ? { underline } : {}) }),
        className,
      )}
    />
  );
}

// A link that looks like a button; Link would add its own text color, which wins on hover.
export function ButtonLink({
  variant,
  size,
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <a
      {...rest}
      className={join(
        buttonClasses({ ...(variant ? { variant } : {}), ...(size ? { size } : {}) }),
        className,
      )}
    />
  );
}

// Malphas Table keeps its own horizontal scroller, so a wide table never scrolls the page.
export function Table({
  children,
  ...rest
}: HTMLAttributes<HTMLTableElement> & { children: ReactNode }) {
  return (
    <div className="w-full overflow-x-auto">
      <table {...rest} className={join(TABLE_CLASSES, rest.className)}>
        {children}
      </table>
    </div>
  );
}

export function THead(props: { children: ReactNode }) {
  return <thead className={THEAD_CLASSES}>{props.children}</thead>;
}

export function TBody(props: { children: ReactNode }) {
  return <tbody className={TBODY_CLASSES}>{props.children}</tbody>;
}

export function TH({ className, scope, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th {...rest} scope={scope ?? 'col'} className={join('font-medium', className)} />;
}

export function TD({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...rest} className={join('text-fg', className)} />;
}

// Malphas Loading, kind spinner, size md, variant primary.
export function Spinner({ label = 'Carregando' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-1 text-primary">
      <span className="inline-block animate-spin rounded-full border-current border-r-transparent size-6 border-2" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
