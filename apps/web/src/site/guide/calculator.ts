import {
  annexRule,
  type Band6Iss,
  BAND6_ISS,
  fatorR,
  rbt12Window,
  type RetainedIss,
  type RevenueKind,
  type SimplesAnnex,
  simplesBand,
  simplesMonth,
  simplesShares,
} from '@notaflow/provider-nacional/simples';
import { track } from '../../analytics/analytics';
import { brasiliaToday, parsePercent } from '../../format';
import { ANNEX_QUESTIONS, type AnnexAnswer, annexFromAnswers } from './annexQuestions';
import {
  ANNEX_CHOICES,
  type AnnexChoice,
  activityRow,
  buildCalculatorForm,
  historyTable,
  PAYROLL,
} from './calculatorForm';
import * as text from './calculatorText';
import {
  alert,
  ANNEX_LABEL,
  type LineView,
  moneyField,
  ratio,
  renderResult,
} from './calculatorView';
import { h } from './dom';
import { parseMoney } from './money';

const SUBLIMIT = 360_000_000;
const SIMPLES_LIMIT = 480_000_000;
const CHOSEN = 'você escolheu este Anexo';

const index = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const monthOf = (value: number) =>
  `${Math.floor(value / 12)}-${String((value % 12) + 1).padStart(2, '0')}`;
const addMonths = (month: string, count: number) => monthOf(index(month) + count);
const showMonth = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;
const isMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const isChoice = (value: string): value is AnnexChoice =>
  ANNEX_CHOICES.some(([choice]) => choice === value);
const isKind = (value: string): value is RevenueKind =>
  value === 'normal' || value === 'iss_retained' || value === 'export';
const isBand6Iss = (value: string): value is Band6Iss =>
  (BAND6_ISS as readonly string[]).includes(value);

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

  const month = () => (isMonth(valueOf('month')) ? valueOf('month') : null);
  // A blank start means 13 months or more, so the full window applies.
  const start = (current: string) => {
    const typed = valueOf('activity-start');
    return isMonth(typed) ? typed : addMonths(current, -24);
  };
  const historyMonths = (current: string) => {
    const first = Math.max(index(start(current)), index(current) - 12);
    return Array.from({ length: Math.max(index(current) - first, 0) }, (_, i) =>
      monthOf(first + i),
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
      index(start(current)) <= index(before)
        ? moneyField(
            'retained-history',
            `Receita de ${showMonth(before)} (só para a alíquota do ISS retido)`,
          )
        : '',
    );
  }

  function updateBand6() {
    const current = month();
    if (!current) return;
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
          ? text.OUT_OF_SCOPE
          : `${ANNEX_LABEL[answer.result]} (${answer.law}).`;
    const extras = [...parts.activities.querySelectorAll('select')].filter((select) =>
      select.name.endsWith('-annex'),
    );
    parts.fatorStep.hidden =
      answer.result !== 'fator_r' && !extras.some((select) => select.value === 'fator_r');
  }

  function suggest() {
    const cnae = valueOf('cnae').replace(/\D/g, '');
    const rule = cnae.length >= 2 ? annexRule([cnae]) : null;
    if (!rule) return parts.cnaeHint.replaceChildren();
    parts.cnaeHint.textContent = `Pelo CNAE, o Anexo sugerido é: ${ANNEX_LABEL[rule]} (sugestão: confirme com seu contador). Marcamos as respostas abaixo: confira cada uma.`;
    const yes = rule === 'IV' ? 'annex_iv' : rule === 'fator_r' ? 'fator_r_listed' : null;
    for (const item of ANNEX_QUESTIONS) {
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
  form.addEventListener('change', updateAnnex);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    calculate();
  });
  buildHistory();
  updateAnnex();

  function calculate() {
    for (const slot of form.querySelectorAll('[data-error-for]')) slot.textContent = '';
    outcome.replaceChildren();
    result.replaceChildren();
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
    if (!current) fail('month', 'Escolha o mês do cálculo.');
    const typedStart = valueOf('activity-start');
    if (current && isMonth(typedStart) && index(typedStart) > index(current))
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
          choice: isChoice(annex) ? annex : 'III',
          kind: isKind(kind) ? kind : 'normal',
          revenueCents: money(`${id}-revenue`),
          law: CHOSEN,
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
    const year = money('year-revenue');
    const todayDas = valueOf('today-das') === '' ? null : money('today-das');
    const todayRate = valueOf('today-rate') === '' ? null : parsePercent(valueOf('today-rate'));
    if (valueOf('today-rate') !== '' && todayRate === null)
      fail('today-rate', 'Alíquota inválida. Use o formato 6,00.');
    if (current)
      for (const item of historyMonths(current)) {
        money(`history-${item}`, 'history');
        money(`export-${item}`, 'history');
      }
    const priorRevenue = field('retained-history') ? money('retained-history') : 0;
    const total = sum([...Object.values(own), ...extras.map((line) => line.revenueCents)]);
    if (!bad && total === 0) fail('revenue-normal', 'Informe a receita do mês.');
    if (bad || !current) return;

    const say = (kind: 'warning' | 'error', ...lines: string[]) =>
      outcome.replaceChildren(alert(kind, ...lines));
    if (form.querySelector<HTMLInputElement>('[name="fixed-iss"]')?.checked)
      return say('warning', ...text.FIXED_ISS);
    if (year > SIMPLES_LIMIT) return say('error', text.EXIT);
    if (year > SUBLIMIT * 1.2) return say('warning', text.OVER_SUBLIMIT);
    const annex = annexAnswer();
    if (annex.result === 'undecided') return say('warning', text.UNDECIDED);
    if (annex.result === 'out_of_scope') return say('warning', text.OUT_OF_SCOPE);

    // Step 3: one RBT12 per market (CGSN 140, art. 23); the month's own revenue serves the first month.
    const lines = [
      ...(['normal', 'iss_retained', 'export'] as const).map((kind) => ({
        choice: annex.result,
        kind,
        revenueCents: own[kind],
        law: annex.law === CHOSEN ? CHOSEN : `pelas suas respostas (${annex.law})`,
      })),
      ...extras,
    ].filter((line) => line.revenueCents > 0);
    const activityStart = start(current);
    const monthTotal = (exported: boolean) =>
      sum(lines.filter((line) => (line.kind === 'export') === exported).map((l) => l.revenueCents));
    const domestic = rbt12Window({
      month: current,
      activityStart,
      revenues: { ...typedHistory('history', current), [current]: monthTotal(false) },
    });
    const foreign = rbt12Window({
      month: current,
      activityStart,
      revenues: { ...typedHistory('export', current), [current]: monthTotal(true) },
    });
    if (simplesBand(domestic.rbt12Cents) === null || simplesBand(foreign.rbt12Cents) === null)
      return say('error', text.EXIT);
    const band6Answer = valueOf('band6-iss');
    const band6Iss = isBand6Iss(band6Answer) ? band6Answer : null;
    if (simplesBand(domestic.rbt12Cents) === 6 && !band6Iss) {
      parts.band6.hidden = false;
      return setError('band6-iss', 'Escolha onde fica o ISS na faixa 6.');
    }

    // Step 2: the payroll follows the same window and annualization as the revenue (art. 26 §4º).
    const scale = domestic.rule === 'full' ? 1 : 12 / domestic.months.length;
    const annualized = Object.fromEntries(
      PAYROLL.map(([part]) => [part, Math.round(payroll[part] * scale)]),
    ) as typeof payroll;
    const fator = lines.some((line) => line.choice === 'fator_r')
      ? fatorR({ payroll: annualized, rbt12Cents: domestic.rbt12Cents + foreign.rbt12Cents })
      : null;
    const annexOf = (choice: AnnexChoice): SimplesAnnex =>
      choice === 'fator_r' ? (fator?.annex ?? 'V') : choice;
    const reasonOf = (choice: AnnexChoice, law: string) =>
      choice === 'fator_r' && fator
        ? `Fator R de ${ratio(fator.ratioHundredths)}, ${fator.annex === 'III' ? 'igual ou acima de' : 'abaixo de'} 0,28 (LC 123, art. 18 §5º-J e §5º-M).`
        : `${law}.`;

    // Step 4: the retained rate uses the band of the month before the service (CGSN 140, art. 27 I).
    const prior = addMonths(current, -1);
    const rule = checked('retained-rule');
    const retainedIss: RetainedIss =
      rule === 'first_month' || index(prior) < index(activityStart)
        ? 'first_month'
        : rule === 'not_on_invoice'
          ? 'not_on_invoice'
          : {
              rbt12Cents: rbt12Window({
                month: prior,
                activityStart,
                revenues: {
                  ...typedHistory('history', current),
                  [addMonths(current, -13)]: priorRevenue,
                },
              }).rbt12Cents,
            };
    const options = band6Iss ? { band6Iss } : {};
    const rbt12Of = (kind: RevenueKind) =>
      kind === 'export' ? foreign.rbt12Cents : domestic.rbt12Cents;
    let calculated;
    try {
      calculated = simplesMonth({
        rbt12Cents: domestic.rbt12Cents,
        exportRbt12Cents: foreign.rbt12Cents,
        ...options,
        lines: lines.map((line) => ({
          annex: annexOf(line.choice),
          kind: line.kind,
          revenueCents: line.revenueCents,
          ...(line.kind === 'iss_retained' ? { retainedIss } : {}),
        })),
      });
    } catch (error) {
      if (error instanceof RangeError) return say('error', text.EXIT);
      throw error;
    }
    const views: LineView[] = lines.map((line) => ({
      reason: reasonOf(line.choice, line.law),
      rbt12Cents: rbt12Of(line.kind),
      shares: simplesShares(annexOf(line.choice), rbt12Of(line.kind), options),
    }));

    const todayCents =
      todayDas ?? (todayRate === null ? null : Math.round((total * todayRate) / 10_000));
    result.replaceChildren(
      ...renderResult({
        domestic,
        foreign: monthTotal(true) > 0 ? foreign : null,
        fator: fator && {
          ...fator,
          payrollCents: sum(Object.values(annualized)),
          rbt12Cents: domestic.rbt12Cents + foreign.rbt12Cents,
        },
        month: calculated,
        views,
        todayCents,
        showMonth,
      }),
    );
    track('guide_calculator', { action: 'calculated' });
    if (todayCents !== null) track('guide_calculator', { action: 'compared' });
  }
}
