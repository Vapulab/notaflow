import {
  addMonths,
  annexRule,
  monthIndex,
  monthName,
  rbt12Window,
  type RevenueKind,
  simplesBand,
} from '@notaflow/provider-nacional/simples';
import { track } from '../../analytics/analytics';
import { isBand6Iss } from '../../components/band6IssText';
import { brasiliaToday, parsePercent } from '../../format';
import { ANNEX_QUESTIONS, type AnnexAnswer, annexFromAnswers } from './annexQuestions';
import { type CalculatorInputs, CHOSEN, computeMonth } from './calculatorCompute';
import {
  ANNEX_CHOICES,
  type AnnexChoice,
  activityRow,
  buildCalculatorForm,
  historyTable,
} from './calculatorForm';
import * as text from './calculatorText';
import { alert, ANNEX_LABEL, moneyField, renderResult, showMonth } from './calculatorView';
import { h } from './dom';
import { parseMoney } from './money';

// "2026-09" or "09/2026" (a browser without a month picker shows a text field); null otherwise.
export function parseMonth(value: string): string | null {
  const typed = value.trim();
  const iso = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(typed);
  if (iso) return typed;
  const br = /^(0?[1-9]|1[0-2])\/(\d{4})$/.exec(typed);
  return br ? `${br[2]}-${(br[1] ?? '').padStart(2, '0')}` : null;
}

const isChoice = (value: string): value is AnnexChoice =>
  ANNEX_CHOICES.some(([choice]) => choice === value);
const isKind = (value: string): value is RevenueKind =>
  value === 'normal' || value === 'iss_retained' || value === 'export';
const RETAINED_RULES = ['rule', 'first_month', 'not_on_invoice'] as const;
const isRetainedRule = (value: string | null): value is CalculatorInputs['retainedRule'] =>
  (RETAINED_RULES as readonly (string | null)[]).includes(value);

// The PGDAS-D steps in the browser: it sends nothing, and the tables come from provider-nacional.
export function mountCalculator(root: HTMLElement): void {
  const parts = buildCalculatorForm();
  const { form } = parts;
  const outcome = h('div', { 'data-outcome': '', 'aria-live': 'polite' });
  const result = h('div', { 'data-result': '', 'aria-live': 'polite' });
  root.replaceChildren(form, outcome, result);

  const field = (name: string) =>
    form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      `[name="${name}"]`,
    );
  const valueOf = (name: string) => field(name)?.value.trim() ?? '';
  const checked = (name: string) =>
    form.querySelector<HTMLInputElement>(`[name="${name}"]:checked`)?.value ?? null;
  const setError = (name: string, message: string) => {
    const slot = form.querySelector(`[data-error-for="${name}"]`);
    if (slot) slot.textContent = message;
  };
  const monthField = field('month');
  if (monthField) monthField.value = addMonths(brasiliaToday().slice(0, 7), -1);

  const month = () => parseMonth(valueOf('month'));
  // A blank start means 13 months or more, so the full window applies.
  const start = (current: string) =>
    parseMonth(valueOf('activity-start')) ?? addMonths(current, -24);
  const startsLater = (current: string) => monthIndex(start(current)) > monthIndex(current);
  const historyMonths = (current: string) => {
    const first = Math.max(monthIndex(start(current)), monthIndex(current) - 12);
    return Array.from({ length: Math.max(monthIndex(current) - first, 0) }, (_, i) =>
      monthName(first + i),
    );
  };
  const typedHistory = (prefix: string, current: string) =>
    Object.fromEntries(
      historyMonths(current).map((item) => [item, parseMoney(valueOf(`${prefix}-${item}`)) ?? 0]),
    );

  function buildHistory() {
    const current = month();
    const kept = new Map(
      [...parts.history.querySelectorAll('input')].map((cell) => [cell.name, cell.value]),
    );
    if (!current) return parts.history.replaceChildren();
    parts.history.replaceChildren(...historyTable(historyMonths(current), kept, showMonth));
    // The retained ISS rate needs the window of the month before, one month older than this one.
    const before = addMonths(current, -13);
    parts.retainedMonth.replaceChildren(
      monthIndex(start(current)) <= monthIndex(before)
        ? moneyField(
            'retained-history',
            `Receita de ${showMonth(before)} (só para a alíquota do ISS retido)`,
          )
        : '',
    );
  }

  function updateBand6() {
    const current = month();
    if (!current || startsLater(current)) return;
    const revenues = typedHistory('history', current);
    const { rbt12Cents } = rbt12Window({ month: current, activityStart: start(current), revenues });
    parts.band6.hidden = simplesBand(rbt12Cents) !== 6;
  }

  function annexAnswer(): AnnexAnswer {
    const mode = valueOf('annex-mode');
    if (isChoice(mode)) return { result: mode, law: CHOSEN };
    const answers = Object.fromEntries(
      ANNEX_QUESTIONS.map((item) => {
        const value = checked(`q-${item.id}`);
        return [item.id, value === null ? undefined : value === 'yes'];
      }),
    );
    return annexFromAnswers(answers);
  }

  function updateAnnex() {
    parts.questions.hidden = valueOf('annex-mode') !== 'questions';
    const answer = annexAnswer();
    parts.annexState.textContent =
      answer.result === 'undecided'
        ? text.UNDECIDED_SHORT
        : answer.result === 'out_of_scope'
          ? answer.reason === 'labor'
            ? text.LABOR
            : text.OUT_OF_SCOPE
          : `${ANNEX_LABEL[answer.result]} (${answer.law}).${answer.note ? ` ${answer.note}` : ''}`;
    const extras = [...parts.activities.querySelectorAll('select')].filter((select) =>
      select.name.endsWith('-annex'),
    );
    parts.fatorStep.hidden =
      answer.result !== 'fator_r' && !extras.some((select) => select.value === 'fator_r');
  }

  // Questions the reader answered by hand; a CNAE suggestion never overwrites them.
  const touched = new Set<string>();
  function suggest() {
    const cnae = valueOf('cnae').replace(/\D/g, '');
    const rule = cnae.length >= 2 ? annexRule([cnae]) : null;
    if (!rule) return parts.cnaeHint.replaceChildren();
    parts.cnaeHint.textContent = `Pelo CNAE, o Anexo sugerido é: ${ANNEX_LABEL[rule]} (sugestão: confirme com seu contador). Marcamos as respostas abaixo: confira cada uma.`;
    const yes = rule === 'IV' ? 'annex_iv' : rule === 'fator_r' ? 'fator_r_listed' : null;
    for (const item of ANNEX_QUESTIONS) {
      if (touched.has(item.id)) continue;
      const answer = item.id === yes ? 'yes' : 'no';
      const radio = form.querySelector<HTMLInputElement>(`#q-${item.id}-${answer}`);
      if (radio) radio.checked = true;
    }
    const mode = field('annex-mode');
    if (mode) mode.value = 'questions';
  }

  let activityCount = 0;
  parts.addActivity.addEventListener('click', () => {
    activityCount += 1;
    parts.activities.append(
      activityRow(activityCount, (row) => {
        row.remove();
        updateAnnex();
      }),
    );
  });

  parts.paste.addEventListener('click', () => {
    setError('history-paste', '');
    const values = valueOf('history-paste')
      .split(/[\n;\t]+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const cells = [...parts.history.querySelectorAll<HTMLInputElement>('input[name^="history-"]')];
    if (values.length > cells.length || values.some((value) => parseMoney(value) === null))
      return setError(
        'history-paste',
        `Cole até ${cells.length} valores, como 10.000,00, um por linha.`,
      );
    values.forEach((value, i) => {
      const cell = cells[i];
      if (cell) cell.value = value;
    });
    updateBand6();
  });

  form.addEventListener('input', (event) => {
    const name = (event.target as { name?: string } | null)?.name;
    if (name === 'cnae') suggest();
    if (name === 'month' || name === 'activity-start') buildHistory();
    updateAnnex();
    updateBand6();
  });
  form.addEventListener('change', (event) => {
    const name = (event.target as { name?: string } | null)?.name ?? '';
    if (name.startsWith('q-')) touched.add(name.slice(2));
    updateAnnex();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    for (const slot of form.querySelectorAll('[data-error-for]')) slot.textContent = '';
    outcome.replaceChildren();
    result.replaceChildren();
    const inputs = validate();
    if (!inputs) return;
    const answer = computeMonth(inputs);
    if (answer.kind === 'stop')
      return outcome.replaceChildren(alert(answer.level, ...answer.lines));
    if (answer.kind === 'band6_missing') {
      parts.band6.hidden = false;
      return setError('band6-iss', 'Escolha onde fica o ISS na faixa 6.');
    }
    result.replaceChildren(...renderResult(answer.view));
    track('guide_calculator', { action: 'calculated' });
    if (answer.view.todayCents !== null) track('guide_calculator', { action: 'compared' });
  });
  buildHistory();
  updateAnnex();

  // Reads the form; each bad field gets its own error, and nothing is calculated.
  function validate(): CalculatorInputs | null {
    let bad = false;
    const fail = (name: string, message: string) => {
      setError(name, message);
      bad = true;
    };
    const money = (name: string, slot = name) => {
      const cents = valueOf(name) === '' ? 0 : parseMoney(valueOf(name));
      if (cents === null) fail(slot, text.BAD_MONEY);
      return cents ?? 0;
    };
    const current = month();
    if (!current) fail('month', 'Escolha o mês do cálculo, como 2026-09 ou 09/2026.');
    const typedStart = valueOf('activity-start');
    if (typedStart !== '' && !parseMonth(typedStart))
      fail('activity-start', 'Mês inválido. Use 2026-09 ou 09/2026.');
    if (current && startsLater(current))
      fail('activity-start', 'O início de atividade vem depois do mês do cálculo.');
    const own = {
      normal: money('revenue-normal'),
      iss_retained: money('revenue-retained'),
      export: money('revenue-export'),
    };
    const extras = [...parts.activities.querySelectorAll<HTMLElement>('[data-activity]')].map(
      (row) => {
        const id = row.dataset.activity ?? '';
        const annex = valueOf(`${id}-annex`);
        const kind = valueOf(`${id}-kind`);
        return {
          choice: isChoice(annex) ? annex : ('III' as const),
          kind: isKind(kind) ? kind : ('normal' as const),
          revenueCents: money(`${id}-revenue`),
        };
      },
    );
    const payroll = {
      salaries: money('payroll-salaries'),
      proLabore: money('payroll-proLabore'),
      fgts: money('payroll-fgts'),
      cpp: money('payroll-cpp'),
      other: money('payroll-other'),
    };
    const yearCents = money('year-revenue');
    const todayDas = valueOf('today-das') === '' ? null : money('today-das');
    const todayRate = valueOf('today-rate') === '' ? null : parsePercent(valueOf('today-rate'));
    if (valueOf('today-rate') !== '' && todayRate === null)
      fail('today-rate', 'Alíquota inválida. Use o formato 6,00.');
    const months = current && !startsLater(current) ? historyMonths(current) : [];
    for (const item of months) {
      money(`history-${item}`, 'history');
      money(`export-${item}`, 'history');
    }
    const priorRevenue = field('retained-history') ? money('retained-history') : 0;
    const total = [...Object.values(own), ...extras.map((line) => line.revenueCents)].reduce(
      (sum, cents) => sum + cents,
      0,
    );
    if (!bad && total === 0) fail('revenue-normal', 'Informe a receita do mês.');
    if (bad || !current) return null;
    const band6 = valueOf('band6-iss');
    const rule = checked('retained-rule');
    return {
      month: current,
      activityStart: start(current),
      annex: annexAnswer(),
      own,
      extras,
      history: typedHistory('history', current),
      exportHistory: typedHistory('export', current),
      priorRevenue,
      payroll,
      yearCents,
      fixedIss: form.querySelector<HTMLInputElement>('[name="fixed-iss"]')?.checked ?? false,
      band6Iss: isBand6Iss(band6) ? band6 : null,
      retainedRule: isRetainedRule(rule) ? rule : 'rule',
      todayDas,
      todayRate,
    };
  }
}
