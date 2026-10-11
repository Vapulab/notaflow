import { centsInput } from './format';

// Fills a pattern ('#' is one character) only as far as the text goes, so a mask works while typing.
function fill(pattern: string, chars: string): string {
  let out = '';
  let next = 0;
  for (const slot of pattern) {
    if (next >= chars.length) break;
    if (slot === '#') out += chars[next++];
    else out += slot;
  }
  return out;
}

const digits = (text: string, max: number) => text.replace(/\D/g, '').slice(0, max);

// Cash register: every digit enters from the right, so "123456" is "1.234,56".
export function maskCents(text: string): string {
  const cents = Number(digits(text, 14).replace(/^0+/, '').slice(0, 13) || '0');
  return cents === 0 ? '' : centsInput(cents);
}

export function maskCnpj(text: string): string {
  const chars = text
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 14);
  return fill('##.###.###/####-##', chars);
}

export const maskCpf = (text: string) => fill('###.###.###-##', digits(text, 11));

export const maskCep = (text: string) => fill('#####-###', digits(text, 8));

export function maskPhone(text: string): string {
  const all = text.replace(/\D/g, '');
  // A stored phone may carry the country code 55.
  const d = (all.length > 11 && all.startsWith('55') ? all.slice(2) : all).slice(0, 11);
  return fill(d.length === 11 ? '(##) #####-####' : '(##) ####-####', d);
}
