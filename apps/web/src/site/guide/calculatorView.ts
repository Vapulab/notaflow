import type {
  SimplesAnnex,
  SimplesMonth,
  SimplesShares,
  SimplesTax,
} from '@notaflow/provider-nacional/simples';
import { formatCents, percentInput } from '../../format';
import { alertClasses, INPUT_CLASSES, LABEL_CLASSES, SELECT_CLASSES } from '../../ui/classes';
import * as text from './calculatorText';
import { h } from './dom';

export const percent = (hundredths: number) => `${percentInput(hundredths)}%`;
export const ratio = (hundredths: number) => percentInput(hundredths);

export function moneyField(name: string, label: string, hint?: string): HTMLDivElement {
  return h(
    'div',
    { class: 'mt-3 flex flex-col gap-1' },
    h('label', { for: `calc-${name}`, class: LABEL_CLASSES }, label),
    h('input', {
      id: `calc-${name}`,
      name,
      inputmode: 'decimal',
      autocomplete: 'off',
      placeholder: '0,00',
      class: `${INPUT_CLASSES} w-full`,
    }),
    hint ? h('span', { class: 'text-xs text-muted' }, hint) : null,
    h('p', { class: 'nf-text-danger text-sm !mt-0', 'data-error-for': name }),
  );
}

export function selectField(
  name: string,
  label: string,
  options: [string, string][],
  hint?: string,
): HTMLDivElement {
  return h(
    'div',
    { class: 'mt-3 flex flex-col gap-1' },
    h('label', { for: `calc-${name}`, class: LABEL_CLASSES }, label),
    h(
      'select',
      { id: `calc-${name}`, name, class: SELECT_CLASSES },
      ...options.map(([value, text]) => h('option', { value }, text)),
    ),
    hint ? h('span', { class: 'text-xs text-muted' }, hint) : null,
    h('p', { class: 'nf-text-danger text-sm !mt-0', 'data-error-for': name }),
  );
}

export function step(id: string, title: string, ...children: (Node | string | null)[]) {
  return h(
    'fieldset',
    { class: 'mt-8 rounded-lg border border-border p-4 sm:p-5', 'data-step': id },
    h('legend', { class: 'px-1 font-display text-lg font-semibold text-fg' }, title),
    ...children,
  );
}

export const source = (text: string) => h('p', { class: 'text-xs text-muted' }, `Fonte: ${text}`);

export const alert = (kind: 'info' | 'warning' | 'error', ...lines: string[]) =>
  h(
    'div',
    { class: `${alertClasses(kind)} mt-4 flex-col` },
    ...lines.map((line) => h('p', { class: '!mt-0' }, line)),
  );

const TAX_NAMES: [SimplesTax, string][] = [
  ['irpj', 'IRPJ'],
  ['csll', 'CSLL'],
  ['cofins', 'Cofins'],
  ['pis', 'PIS/Pasep'],
  ['cpp', 'CPP (INSS patronal)'],
  ['iss', 'ISS'],
];

const KIND_TEXT = {
  normal: 'Receita normal',
  iss_retained: 'Receita com ISS retido pelo cliente',
  export: 'Exportação de serviço',
} as const;

const KIND_RATE = {
  normal: '',
  iss_retained: 'Sem a parte do ISS, que o cliente retém (Res. CGSN 140, art. 25 §9º II)',
  export: 'Sem as partes de ISS, PIS e Cofins, por ser exportação (LC 123, art. 18 §14)',
} as const;

export interface LineView {
  reason: string;
  rbt12Cents: number;
  shares: SimplesShares;
}

// (RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12, with the reader's numbers.
export function formula(rbt12Cents: number, shares: SimplesShares): string {
  if (rbt12Cents === 0)
    return `Receita dos 12 meses igual a zero: conta como R$ 1,00, e a alíquota é a nominal da faixa 1, ${percent(shares.nominalRate)} (Res. CGSN 140, art. 21, parágrafo único).`;
  const effective = Math.round(
    ((rbt12Cents * shares.nominalRate) / 10_000 - shares.deductionCents) * (10_000 / rbt12Cents),
  );
  const base = formatCents(rbt12Cents);
  return `(${base} × ${percent(shares.nominalRate)} − ${formatCents(shares.deductionCents)}) ÷ ${base} = ${percent(effective)}`;
}

export function renderLines(month: SimplesMonth, views: LineView[]): HTMLElement[] {
  return month.lines.map((line, index) => {
    const view = views[index];
    if (!view) return h('div');
    const rows = TAX_NAMES.filter(([tax]) => line.taxes[tax] !== undefined).map(([tax, name]) =>
      h('tr', {}, h('td', {}, name), h('td', {}, formatCents(line.taxes[tax] ?? 0))),
    );
    return h(
      'section',
      { class: 'guide-note !mt-4' },
      h('h3', { class: '!mt-0' }, `${KIND_TEXT[line.kind]}: ${formatCents(line.revenueCents)}`),
      h('p', {}, `Anexo ${line.annex}: ${view.reason}`),
      h('p', {}, `Faixa ${view.shares.band}. ${formula(view.rbt12Cents, view.shares)}`),
      view.shares.band === 6 && view.shares.taxes.iss !== undefined
        ? h(
            'p',
            {},
            `Alíquota efetiva com o ISS desta faixa: ${percent(view.shares.effectiveRate)}.`,
          )
        : null,
      line.kind === 'normal'
        ? h('p', {}, `Alíquota desta receita: ${percent(line.rate)}.`)
        : h('p', {}, `${KIND_RATE[line.kind]}: ${percent(line.rate)}.`),
      h(
        'div',
        { class: 'guide-table' },
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Imposto no DAS'), h('th', {}, 'Valor'))),
          h('tbody', {}, ...rows),
        ),
      ),
      h('p', { class: 'font-semibold' }, `DAS desta receita: ${formatCents(line.dasCents)}`),
      line.retainedIss
        ? h(
            'p',
            {},
            `Fora do DAS, o cliente retém ${formatCents(line.retainedIss.cents)} de ISS, à alíquota de ${percent(line.retainedIss.rate)} (Res. CGSN 140, art. 27).`,
          )
        : null,
    );
  });
}

export const ANNEX_LABEL: Record<SimplesAnnex | 'fator_r', string> = {
  I: 'Anexo I',
  II: 'Anexo II',
  III: 'Anexo III',
  IV: 'Anexo IV',
  V: 'Anexo V',
  fator_r: 'Anexo III ou V, pelo Fator R',
};

export const inputClasses = `${INPUT_CLASSES} w-full`;

type Window = Parameters<typeof text.windowText>[0];

export function renderResult(input: {
  domestic: Window;
  foreign: Window | null;
  fator: {
    ratioHundredths: number;
    annex: 'III' | 'V';
    payrollCents: number;
    rbt12Cents: number;
  } | null;
  month: SimplesMonth;
  views: LineView[];
  todayCents: number | null;
  showMonth: (month: string) => string;
}): HTMLElement[] {
  const { fator, month, todayCents } = input;
  const total = formatCents(month.totalCents);
  const difference = todayCents === null ? 0 : todayCents - month.totalCents;
  const compared =
    difference === 0
      ? 'Os valores são iguais.'
      : `Diferença: ${formatCents(Math.abs(difference))} ${difference > 0 ? 'a mais' : 'a menos'} do que o cálculo.`;
  return [
    h('h2', {}, 'O seu DAS do mês'),
    h('p', {}, text.windowText(input.domestic, 'Receita dos 12 meses', input.showMonth)),
    input.foreign
      ? h(
          'p',
          {},
          text.windowText(input.foreign, 'Receita de exportação dos 12 meses', input.showMonth),
        )
      : h('span'),
    fator
      ? h(
          'p',
          {},
          `Fator R: folha de ${formatCents(fator.payrollCents)} ÷ receita de ${formatCents(fator.rbt12Cents)} = ${ratio(fator.ratioHundredths)}, cortado em duas casas. O limite é 0,28: a atividade usa o ${ANNEX_LABEL[fator.annex]}.`,
        )
      : h('span'),
    ...renderLines(month, input.views),
    ...month.warnings.map((warning) => alert('warning', text.WARNINGS[warning])),
    h('p', { class: 'mt-6 font-display text-2xl font-semibold' }, `DAS do mês: ${total}`),
    ...(todayCents === null
      ? []
      : [
          h('h3', {}, 'Comparação'),
          h(
            'p',
            {},
            `Você paga hoje ${formatCents(todayCents)}. Pelo cálculo, o DAS seria ${total}. ${compared}`,
          ),
          h('p', {}, text.COMPARE_NEUTRAL),
        ]),
    h('p', { class: 'text-sm text-muted' }, text.TABLES_DATE),
  ];
}
