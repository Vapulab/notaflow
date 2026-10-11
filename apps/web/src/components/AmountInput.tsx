import type { InputHTMLAttributes } from 'react';
import { maskCents } from '../masks';
import { Input } from '../ui';

const SYMBOLS: Record<string, string> = { BRL: 'R$', USD: 'US$', EUR: '€' };

export const currencySymbol = (code: string) => SYMBOLS[code] ?? code;

// An amount or a percent typed like a cash register, with its unit inside the field.
export function AmountInput(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
    value: string;
    onValueChange: (text: string) => void;
    unit: string; // "R$", "US$", "€" before the number; "%" after it
  },
) {
  const { value, onValueChange, unit, className, ...rest } = props;
  const after = unit === '%';
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 flex items-center text-sm text-muted ${after ? 'right-3' : 'left-3'}`}
      >
        {unit}
      </span>
      <Input
        {...rest}
        inputMode="numeric"
        value={value}
        onChange={(e) => onValueChange(maskCents(e.target.value))}
        className={`${after ? 'pr-8 text-right' : 'pl-11'} ${className ?? ''}`}
      />
    </div>
  );
}
