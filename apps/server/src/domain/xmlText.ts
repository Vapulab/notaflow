const PLAIN: Record<number, string> = {
  0x2018: "'",
  0x2019: "'",
  0x201c: '"',
  0x201d: '"',
  0x2013: '-',
  0x2014: '-',
  0x00a0: ' ',
};

const isControl = (code: number) =>
  code < 0x20 ? code !== 0x09 && code !== 0x0a && code !== 0x0d : code === 0x7f;
// TSString of the DPS XSD: Latin-1, no line breaks; this also refuses the C1 control range.
const isLatin1Text = (code: number) =>
  (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff);

// Typed text, trimmed and with typographic quotes and dashes made plain; null when the XSD would refuse it.
export function xsdString(value: string): string | null {
  const clean = [...value]
    .map((c) => PLAIN[c.charCodeAt(0)] ?? c)
    .join('')
    .trim();
  if (clean === '') return null;
  return [...clean].every((c) => isLatin1Text(c.charCodeAt(0))) ? clean : null;
}

// TSDesc2000: any text with a character that is not a space; null for blank or control characters.
export function xsdDescription(value: string): string | null {
  const clean = value.trim();
  if (clean === '') return null;
  return [...clean].some((c) => isControl(c.charCodeAt(0))) ? null : clean;
}

// A real calendar date in YYYY-MM-DD.
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
