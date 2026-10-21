// The GitHub repository is public: what goes there passes through these masks first.
const EDGE_START = '(?<![\\p{L}\\p{N}_@.])';
const EDGE_END = '(?![\\p{L}\\p{N}_])';

const RULES: [RegExp, string][] = [
  [/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu, '[e-mail]'],
  // The alphanumeric CNPJ (from July 2026) keeps two check digits at the end; the numeric one is a case of it.
  [edged('[0-9A-Za-z]{2}\\.[0-9A-Za-z]{3}\\.[0-9A-Za-z]{3}/[0-9A-Za-z]{4}-\\d{2}'), '[CNPJ]'],
  [edged('\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}'), '[CPF]'],
  [edged('[0-9A-Z]{12}\\d{2}'), '[CNPJ]'],
  [
    edged('(?:\\+?55[\\s.-]?)?(?:\\(\\d{2}\\)\\s?|\\d{2}[\\s.-])?9?\\d{4}[\\s.-]?\\d{4}'),
    '[telefone]',
  ],
  // Access keys, account numbers, and anything else long enough to name a person or a company.
  [edged('\\d{8,}'), '[número]'],
];

function edged(pattern: string): RegExp {
  return new RegExp(`${EDGE_START}${pattern}${EDGE_END}`, 'gu');
}

export function maskPersonalData(text: string): string {
  return RULES.reduce((masked, [pattern, label]) => masked.replace(pattern, label), text);
}

const ID_SEGMENT = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^\d{4,}$/,
  /^[0-9A-Z]{12}\d{2}$/,
  /^[\w-]{20,}$/,
];

// The route with every id replaced by :id, so the issue shows the screen and not whose data it was.
export function maskPath(path: string): string {
  const route = path.split(/[?#]/)[0] ?? '';
  return route
    .split('/')
    .map((segment) => (ID_SEGMENT.some((pattern) => pattern.test(segment)) ? ':id' : segment))
    .join('/');
}
