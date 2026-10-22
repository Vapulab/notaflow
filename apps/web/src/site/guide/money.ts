import { parseCents } from '../../format';

// A typed amount in cents: "R$ 1.234,56", "1234,56", "1.000" or "1234"; null when empty or bad.
export function parseMoney(text: string): number | null {
  const value = text.trim().replace(/^R\$\s*/, '');
  return value === '' ? null : parseCents(value);
}
