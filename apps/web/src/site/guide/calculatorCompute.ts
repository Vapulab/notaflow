import {
  addMonths,
  type Band6Iss,
  fatorR,
  monthIndex,
  rbt12Window,
  type RetainedIss,
  type RevenueKind,
  type SimplesAnnex,
  simplesBand,
  simplesMonth,
  simplesShares,
} from '@notaflow/provider-nacional/simples';
import type { AnnexAnswer } from './annexQuestions';
import type { AnnexChoice } from './calculatorForm';
import * as text from './calculatorText';
import { type LineView, ratio, type ResultView } from './calculatorView';

const SUBLIMIT = 360_000_000;
const SIMPLES_LIMIT = 480_000_000;
export const CHOSEN = 'você escolheu este Anexo';

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export interface Payroll {
  salaries: number;
  proLabore: number;
  fgts: number;
  cpp: number;
  other: number;
}

// What the form gives once every field is valid; the amounts are cents, the rates hundredths.
export interface CalculatorInputs {
  month: string;
  activityStart: string;
  annex: AnnexAnswer;
  own: Record<RevenueKind, number>;
  extras: { choice: AnnexChoice; kind: RevenueKind; revenueCents: number }[];
  history: Record<string, number>;
  exportHistory: Record<string, number>;
  // The revenue of the month 13 months back, for the window of the retained ISS.
  priorRevenue: number;
  payroll: Payroll;
  yearCents: number;
  fixedIss: boolean;
  band6Iss: Band6Iss | null;
  retainedRule: 'rule' | 'first_month' | 'not_on_invoice';
  todayDas: number | null;
  todayRate: number | null;
}

export type Outcome =
  | { kind: 'stop'; level: 'warning' | 'error'; lines: string[] }
  | { kind: 'band6_missing' }
  | { kind: 'result'; view: ResultView };

const stop = (level: 'warning' | 'error', ...lines: string[]): Outcome => ({
  kind: 'stop',
  level,
  lines,
});

// The PGDAS-D steps on valid inputs: the warnings that stop the calculation, then the DAS of each line.
export function computeMonth(input: CalculatorInputs): Outcome {
  const { annex, month, activityStart } = input;
  if (input.fixedIss) return stop('warning', ...text.FIXED_ISS);
  if (input.yearCents > SIMPLES_LIMIT) return stop('error', text.EXIT);
  if (input.yearCents > SUBLIMIT * 1.2) return stop('warning', text.OVER_SUBLIMIT);
  if (annex.result === 'undecided') return stop('warning', text.UNDECIDED);
  if (annex.result === 'out_of_scope')
    return stop('warning', annex.reason === 'labor' ? text.LABOR : text.OUT_OF_SCOPE);

  const mainLaw = annex.law === CHOSEN ? CHOSEN : `pelas suas respostas (${annex.law})`;
  const lines = [
    ...(['normal', 'iss_retained', 'export'] as const).map((kind) => ({
      choice: annex.result,
      kind,
      revenueCents: input.own[kind],
      law: mainLaw,
    })),
    ...input.extras.map((line) => ({ ...line, law: CHOSEN })),
  ].filter((line) => line.revenueCents > 0);

  // Step 3: one RBT12 per market (CGSN 140, art. 23); the month's own revenue serves the first month.
  const monthTotal = (exported: boolean) =>
    sum(lines.filter((line) => (line.kind === 'export') === exported).map((l) => l.revenueCents));
  const domestic = rbt12Window({
    month,
    activityStart,
    revenues: { ...input.history, [month]: monthTotal(false) },
  });
  const foreign = rbt12Window({
    month,
    activityStart,
    revenues: { ...input.exportHistory, [month]: monthTotal(true) },
  });
  if (simplesBand(domestic.rbt12Cents) === null || simplesBand(foreign.rbt12Cents) === null)
    return stop('error', text.EXIT);
  if (simplesBand(domestic.rbt12Cents) === 6 && !input.band6Iss) return { kind: 'band6_missing' };

  // Step 2: the payroll follows the same window and annualization as the revenue (art. 26 §4º).
  const scale = domestic.rule === 'full' ? 1 : 12 / domestic.months.length;
  const payroll = Object.fromEntries(
    Object.entries(input.payroll).map(([part, cents]) => [part, Math.round(cents * scale)]),
  ) as unknown as Payroll;
  const bothMarkets = domestic.rbt12Cents + foreign.rbt12Cents;
  const fator = lines.some((line) => line.choice === 'fator_r')
    ? fatorR({ payroll, rbt12Cents: bothMarkets })
    : null;
  const annexOf = (choice: AnnexChoice): SimplesAnnex =>
    choice === 'fator_r' ? (fator?.annex ?? 'V') : choice;
  const reasonOf = (choice: AnnexChoice, law: string) =>
    choice === 'fator_r' && fator
      ? `Fator R de ${ratio(fator.ratioHundredths)}, ${fator.annex === 'III' ? 'igual ou acima de' : 'abaixo de'} 0,28 (LC 123, art. 18 §5º-J e §5º-M).`
      : `${law}.`;

  // Step 4: the retained rate uses the band of the month before the service (CGSN 140, art. 27 I).
  const prior = addMonths(month, -1);
  const retainedIss: RetainedIss =
    input.retainedRule === 'first_month' || monthIndex(prior) < monthIndex(activityStart)
      ? 'first_month'
      : input.retainedRule === 'not_on_invoice'
        ? 'not_on_invoice'
        : {
            rbt12Cents: rbt12Window({
              month: prior,
              activityStart,
              revenues: { ...input.history, [addMonths(month, -13)]: input.priorRevenue },
            }).rbt12Cents,
          };
  const options = input.band6Iss ? { band6Iss: input.band6Iss } : {};
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
    // The window of the retained ISS can pass R$ 4,8 mi when this month's window does not.
    if (error instanceof RangeError) return stop('error', text.EXIT);
    throw error;
  }
  const views: LineView[] = lines.map((line) => ({
    reason: reasonOf(line.choice, line.law),
    rbt12Cents: rbt12Of(line.kind),
    shares: simplesShares(annexOf(line.choice), rbt12Of(line.kind), options),
  }));

  const total = sum(lines.map((line) => line.revenueCents));
  const fromRate = input.todayRate === null ? null : Math.round((total * input.todayRate) / 10_000);
  return {
    kind: 'result',
    view: {
      domestic,
      foreign: monthTotal(true) > 0 ? foreign : null,
      fator: fator && {
        ...fator,
        payrollCents: sum(Object.values(payroll)),
        rbt12Cents: bothMarkets,
      },
      month: calculated,
      views,
      todayCents: input.todayDas ?? fromRate,
      bothCompared: input.todayDas !== null && fromRate !== null,
    },
  };
}
