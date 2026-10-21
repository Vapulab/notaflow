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

// The literal words of the app routes (apps/web/src/router.ts); any other segment may name someone.
const ROUTE_WORDS = new Set([
  'admin',
  'app',
  'cadastro',
  'clientes',
  'comecar',
  'conta',
  'emitentes',
  'emitir',
  'entrar',
  'membros',
  'notas',
  'nova',
  'recuperar-senha',
]);

// The route with every segment that is not a route word replaced by :id, so it shows the screen only.
export function maskPath(path: string): string {
  const route = path.split(/[?#]/)[0] ?? '';
  return route
    .split('/')
    .map((segment) => (segment === '' || ROUTE_WORDS.has(segment) ? segment : ':id'))
    .join('/');
}
