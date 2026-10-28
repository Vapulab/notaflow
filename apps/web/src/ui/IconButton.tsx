import type { ButtonHTMLAttributes, Ref } from 'react';
import { buttonClasses } from './classes';

// 44 px below sm (touch target), 36 px from sm up.
export function IconButton({
  label,
  variant,
  className,
  type,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title'> & {
  ref?: Ref<HTMLButtonElement>;
  label: string;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <button
      {...rest}
      type={type ?? 'button'}
      aria-label={label}
      title={label}
      className={`${buttonClasses({ variant: variant ?? 'secondary', size: 'icon' })}${className ? ` ${className}` : ''}`}
    />
  );
}
