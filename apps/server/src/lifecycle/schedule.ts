// When each lifecycle e-mail is due (RFC_LIFECYCLE_EMAILS): pure functions over dates.

export type Phase = 'activation' | 'first_invoice' | 'reactivation';
export type Variant = '' | 'card' | 'certificate' | 'fiscal' | 'finish';
export type OnboardingStep = 'company' | 'card' | 'certificate' | 'fiscal' | 'sync' | 'done';

export const PHASE_DAYS: Record<Phase, [number, number]> = {
  activation: [1, 4],
  first_invoice: [3, 7],
  reactivation: [45, 90],
};
export const MAX_ANCHOR_AGE_DAYS = 120;

const DAY_MS = 86_400_000;
const CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo',
  weekday: 'short',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
});

function saoPaulo(now: Date) {
  const parts = Object.fromEntries(CLOCK.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    weekday: parts.weekday ?? '',
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

// Monday to Friday, 09:00 to 16:59 in Sao Paulo.
export function isBusinessHours(now: Date): boolean {
  const { weekday, hour } = saoPaulo(now);
  return weekday !== 'Sat' && weekday !== 'Sun' && hour >= 9 && hour < 17;
}

export function startOfDaySaoPaulo(now: Date): Date {
  const { hour, minute, second } = saoPaulo(now);
  const elapsed = ((hour * 60 + minute) * 60 + second) * 1000 + now.getUTCMilliseconds();
  return new Date(now.getTime() - elapsed);
}

// The highest step whose day has passed, so an old account never gets step 1 when step 2 is due.
export function dueStep(phase: Phase, anchor: Date, now: Date): 1 | 2 | null {
  const days = (now.getTime() - anchor.getTime()) / DAY_MS;
  if (days > MAX_ANCHOR_AGE_DAYS) return null;
  const [first, second] = PHASE_DAYS[phase];
  if (days >= second) return 2;
  if (days >= first) return 1;
  return null;
}

export interface Candidate {
  onboardingStep: OnboardingStep;
  accountCreatedAt: Date;
  onboardingDoneAt: Date | null;
  // The newest issued_at of an invoice with origin 'app' in 'producao'.
  lastProductionIssueAt: Date | null;
}

const VARIANT: Record<Exclude<OnboardingStep, 'done'>, Variant> = {
  company: 'card',
  card: 'card',
  certificate: 'certificate',
  fiscal: 'fiscal',
  // The revenue is in; only the last click of onboarding is missing.
  sync: 'finish',
};

export function phaseOf(c: Candidate): { phase: Phase; anchor: Date; variant: Variant } | null {
  if (c.onboardingStep !== 'done') {
    return { phase: 'activation', anchor: c.accountCreatedAt, variant: VARIANT[c.onboardingStep] };
  }
  if (c.lastProductionIssueAt) {
    return { phase: 'reactivation', anchor: c.lastProductionIssueAt, variant: '' };
  }
  return c.onboardingDoneAt
    ? { phase: 'first_invoice', anchor: c.onboardingDoneAt, variant: '' }
    : null;
}
