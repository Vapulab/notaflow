import type { RevenueKind } from '@notaflow/provider-nacional/simples';
import { BAND6_ISS_HINT, BAND6_ISS_LABEL, BAND6_ISS_OPTIONS } from '../../components/band6IssText';
import { buttonClasses, LABEL_CLASSES } from '../../ui/classes';
import { ANNEX_QUESTIONS, type AnnexQuestion } from './annexQuestions';
import * as text from './calculatorText';
import {
  alert,
  ANNEX_LABEL,
  inputClasses,
  moneyField,
  selectField,
  source,
  step,
} from './calculatorView';
import { h } from './dom';

export type AnnexChoice = 'III' | 'IV' | 'V' | 'fator_r';

export const ANNEX_CHOICES: [AnnexChoice, string][] = [
  ['III', ANNEX_LABEL.III],
  ['IV', ANNEX_LABEL.IV],
  ['V', ANNEX_LABEL.V],
  ['fator_r', ANNEX_LABEL.fator_r],
];
const KINDS: [RevenueKind, string][] = [
  ['normal', 'Receita normal'],
  ['iss_retained', 'Com ISS retido pelo cliente'],
  ['export', 'Exportação de serviço'],
];
export const PAYROLL = [
  ['salaries', 'Salários pagos', text.PAYROLL_HELP.salaries],
  ['proLabore', 'Pró-labore', text.PAYROLL_HELP.proLabore],
  ['fgts', 'FGTS recolhido', text.PAYROLL_HELP.fgts],
  ['cpp', 'Contribuição patronal (CPP) recolhida', text.PAYROLL_HELP.cpp],
  ['other', 'Outras remunerações pelo trabalho', text.PAYROLL_HELP.other],
] as const;

const errorSlot = (name: string) =>
  h('p', { class: 'nf-text-danger text-sm !mt-0', 'data-error-for': name });

function labeled(name: string, label: string, control: HTMLElement, hint?: string) {
  return h(
    'div',
    { class: 'mt-3 flex flex-col gap-1' },
    h('label', { for: `calc-${name}`, class: LABEL_CLASSES }, label),
    control,
    hint ? h('span', { class: 'text-xs text-muted' }, hint) : null,
    errorSlot(name),
  );
}

const textInput = (name: string, attributes: Record<string, string> = {}) =>
  h('input', { id: `calc-${name}`, name, autocomplete: 'off', class: inputClasses, ...attributes });

function question(item: AnnexQuestion): HTMLFieldSetElement {
  const option = (value: 'yes' | 'no', label: string) =>
    h(
      'label',
      { class: 'flex items-center gap-2 text-sm text-fg' },
      h('input', { type: 'radio', name: `q-${item.id}`, id: `q-${item.id}-${value}`, value }),
      label,
    );
  return h(
    'fieldset',
    { class: 'mt-4' },
    h('legend', { class: LABEL_CLASSES }, item.text),
    h('div', { class: 'mt-2 flex gap-6' }, option('yes', 'Sim'), option('no', 'Não')),
    h('p', { class: 'text-xs text-muted !mt-1' }, `${item.help} (${item.law})`),
  );
}

const secondary = (size: 'sm' | 'md' = 'md') =>
  `${buttonClasses({ variant: 'secondary', size })} mt-3`;

// The form of the five PGDAS-D steps; calculator.ts reads it by field name.
export function buildCalculatorForm() {
  const parts = {
    cnaeHint: h('p', { class: 'text-sm text-fg', 'aria-live': 'polite' }),
    annexState: h('p', { class: 'text-sm font-semibold text-fg', 'aria-live': 'polite' }),
    questions: h('div', {}, ...ANNEX_QUESTIONS.map(question)),
    history: h('div'),
    retainedMonth: h('div'),
    band6: h(
      'div',
      { hidden: true },
      alert('info', text.BAND6_INTRO),
      selectField(
        'band6-iss',
        BAND6_ISS_LABEL,
        [['', 'Escolha'], ...BAND6_ISS_OPTIONS],
        BAND6_ISS_HINT,
      ),
    ),
    fatorStep: step(
      'fator-r',
      '2. O Fator R',
      h('p', {}, text.FATOR_R_INTRO),
      ...PAYROLL.map(([part, label, help]) => moneyField(`payroll-${part}`, label, help)),
      source(text.FATOR_R_SOURCE),
    ),
    activities: h('div'),
    addActivity: h(
      'button',
      { type: 'button', class: secondary(), 'data-add-activity': '' },
      'Adicionar atividade',
    ),
    paste: h('button', { type: 'button', class: secondary('sm') }, 'Preencher com a lista'),
  };
  parts.fatorStep.hidden = true;
  const retainedRules = text.RETAINED_OPTIONS.map(([value, label]) =>
    h(
      'label',
      { class: 'mt-2 flex items-start gap-2 text-sm text-fg' },
      h('input', {
        type: 'radio',
        name: 'retained-rule',
        value,
        checked: value === 'rule',
        class: 'mt-1',
      }),
      label,
    ),
  );
  const form = h(
    'form',
    { novalidate: true },
    step(
      'annex',
      '1. O Anexo da sua atividade',
      h('p', {}, text.ANNEX_INTRO),
      labeled('cnae', 'CNAE principal (opcional)', textInput('cnae', { placeholder: '0000-0/00' })),
      parts.cnaeHint,
      selectField('annex-mode', 'Como escolher o Anexo', [
        ['questions', 'Responder às perguntas'],
        ...ANNEX_CHOICES,
      ]),
      parts.questions,
      parts.annexState,
      source(text.ANNEX_SOURCE),
    ),
    parts.fatorStep,
    step(
      'rbt12',
      '3. A receita dos últimos 12 meses (RBT12)',
      h('p', {}, text.RBT12_INTRO),
      labeled('month', 'Mês do cálculo', textInput('month', { type: 'month' })),
      labeled(
        'activity-start',
        'Início de atividade (opcional)',
        textInput('activity-start', { type: 'month' }),
        text.START_HINT,
      ),
      parts.history,
      labeled(
        'history-paste',
        'Ou cole a lista da receita do mercado interno',
        h('textarea', {
          id: 'calc-history-paste',
          name: 'history-paste',
          rows: '3',
          class: `${inputClasses} h-auto py-2`,
        }),
        'Um valor por linha, do mês mais antigo ao mais recente.',
      ),
      parts.paste,
      moneyField(
        'year-revenue',
        'Receita deste ano, de janeiro até o mês do cálculo (opcional)',
        text.YEAR_HINT,
      ),
      parts.band6,
      source(text.RBT12_SOURCE),
    ),
    step(
      'month',
      '4. A receita do mês, por tipo',
      h('p', {}, text.MONTH_INTRO),
      moneyField('revenue-normal', 'Receita normal'),
      moneyField('revenue-retained', 'Receita com ISS retido pelo cliente'),
      h(
        'fieldset',
        { class: 'mt-3' },
        h('legend', { class: LABEL_CLASSES }, 'Alíquota do ISS retido'),
        ...retainedRules,
        h('p', { class: 'text-xs text-muted !mt-1' }, text.RETAINED_HINT),
        parts.retainedMonth,
      ),
      moneyField('revenue-export', 'Exportação de serviço', text.EXPORT_HINT),
      h(
        'label',
        { class: 'mt-4 flex items-start gap-2 text-sm text-fg' },
        h('input', { type: 'checkbox', name: 'fixed-iss', class: 'mt-1' }),
        'Minha empresa paga o ISS em valor fixo à prefeitura',
      ),
      source(text.MONTH_SOURCE),
    ),
    h(
      'details',
      { class: 'mt-8 rounded-lg border border-border p-4 sm:p-5', 'data-step': 'activities' },
      h(
        'summary',
        { class: 'cursor-pointer font-display text-lg font-semibold text-fg' },
        '5. Tenho mais de uma atividade',
      ),
      h('p', {}, text.ACTIVITIES_INTRO),
      parts.activities,
      parts.addActivity,
      source(text.ACTIVITIES_SOURCE),
    ),
    step(
      'compare',
      'Compare com o que você paga hoje (opcional)',
      moneyField('today-das', 'DAS que você paga hoje para este mês (R$)'),
      labeled(
        'today-rate',
        'Ou a alíquota que você paga hoje (%)',
        textInput('today-rate', { inputmode: 'decimal', placeholder: '0,00' }),
      ),
    ),
    h(
      'button',
      { type: 'submit', class: `${buttonClasses({ size: 'lg' })} mt-8 w-full sm:w-auto` },
      'Calcular o DAS',
    ),
  );
  return { form, ...parts };
}

// The revenue table of the RBT12 window; typed values survive a change of month.
export function historyTable(
  months: string[],
  kept: Map<string, string>,
  showMonth: (month: string) => string,
) {
  const cell = (prefix: string, month: string, label: string) =>
    h('input', {
      name: `${prefix}-${month}`,
      'aria-label': `${label} de ${showMonth(month)}`,
      inputmode: 'decimal',
      placeholder: '0,00',
      value: kept.get(`${prefix}-${month}`) ?? '',
      class: inputClasses.replace('px-3', 'px-2'),
    });
  return [
    months.length === 0
      ? h('p', { class: 'text-sm' }, text.FIRST_MONTH)
      : h(
          'div',
          { class: 'guide-table' },
          h(
            'table',
            { class: 'guide-history' },
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                h('th', {}, 'Mês'),
                h('th', {}, 'Mercado interno (R$)'),
                h('th', {}, 'Exportação (R$)'),
              ),
            ),
            h(
              'tbody',
              {},
              ...months.map((month) =>
                h(
                  'tr',
                  {},
                  h('td', {}, showMonth(month)),
                  h('td', {}, cell('history', month, 'Receita')),
                  h('td', {}, cell('export', month, 'Exportação')),
                ),
              ),
            ),
          ),
        ),
    errorSlot('history'),
  ];
}

export function activityRow(number: number, onRemove: (row: HTMLElement) => void): HTMLElement {
  const id = `activity-${number}`;
  const remove = h('button', { type: 'button', class: secondary('sm') }, 'Remover');
  const row = h(
    'div',
    { class: 'guide-note !mt-4', 'data-activity': id },
    selectField(`${id}-annex`, `Anexo da atividade ${number + 1}`, ANNEX_CHOICES),
    selectField(`${id}-kind`, 'Tipo da receita', KINDS),
    moneyField(`${id}-revenue`, 'Receita do mês desta atividade'),
    remove,
  );
  remove.addEventListener('click', () => onRemove(row));
  return row;
}
