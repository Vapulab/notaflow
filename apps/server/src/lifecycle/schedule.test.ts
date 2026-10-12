import { expect, test } from 'vitest';
import { dueStep, isBusinessHours, phaseOf, startOfDaySaoPaulo } from './schedule';

const at = (iso: string) => new Date(iso);

test.each([
  ['2026-10-13T12:00:00Z', true], // Tuesday 09:00 in Sao Paulo
  ['2026-10-13T11:59:00Z', false], // 08:59
  ['2026-10-13T19:59:00Z', true], // 16:59
  ['2026-10-13T20:00:00Z', false], // 17:00
  ['2026-10-17T15:00:00Z', false], // Saturday
  ['2026-10-18T15:00:00Z', false], // Sunday
])('business hours at %s: %s', (iso, open) => expect(isBusinessHours(at(iso))).toBe(open));

test('a day starts at midnight in Sao Paulo', () => {
  expect(startOfDaySaoPaulo(at('2026-10-13T02:30:00Z'))).toEqual(at('2026-10-12T03:00:00Z'));
  expect(startOfDaySaoPaulo(at('2026-10-13T15:00:00Z'))).toEqual(at('2026-10-13T03:00:00Z'));
});

test('the highest due step, never step 1 when step 2 is due, nothing after 120 days', () => {
  const anchor = at('2026-10-01T12:00:00Z');
  expect(dueStep('activation', anchor, at('2026-10-01T23:00:00Z'))).toBeNull();
  expect(dueStep('activation', anchor, at('2026-10-02T12:00:00Z'))).toBe(1);
  expect(dueStep('activation', anchor, at('2026-10-05T12:00:00Z'))).toBe(2);
  expect(dueStep('first_invoice', anchor, at('2026-10-03T12:00:00Z'))).toBeNull();
  expect(dueStep('first_invoice', anchor, at('2026-10-04T12:00:00Z'))).toBe(1);
  expect(dueStep('reactivation', anchor, at('2026-11-15T12:00:00Z'))).toBe(1);
  expect(dueStep('reactivation', anchor, at('2026-12-30T12:00:00Z'))).toBe(2);
  expect(dueStep('reactivation', anchor, at('2027-02-01T12:00:00Z'))).toBeNull();
});

test('the phase follows onboarding and production invoices; test invoices do not count', () => {
  const base = {
    accountCreatedAt: at('2026-10-01T00:00:00Z'),
    onboardingDoneAt: null,
    lastProductionIssueAt: null,
  };
  expect(phaseOf({ ...base, onboardingStep: 'company' })).toEqual({
    phase: 'activation',
    anchor: base.accountCreatedAt,
    variant: 'card',
  });
  expect(phaseOf({ ...base, onboardingStep: 'certificate' })).toMatchObject({
    variant: 'certificate',
  });
  expect(phaseOf({ ...base, onboardingStep: 'fiscal' })).toMatchObject({ variant: 'fiscal' });
  expect(phaseOf({ ...base, onboardingStep: 'sync' })).toMatchObject({ variant: 'finish' });
  const done = {
    ...base,
    onboardingStep: 'done' as const,
    onboardingDoneAt: at('2026-10-03T00:00:00Z'),
  };
  expect(phaseOf(done)).toEqual({
    phase: 'first_invoice',
    anchor: done.onboardingDoneAt,
    variant: '',
  });
  expect(phaseOf({ ...done, lastProductionIssueAt: at('2026-10-05T00:00:00Z') })).toEqual({
    phase: 'reactivation',
    anchor: at('2026-10-05T00:00:00Z'),
    variant: '',
  });
  expect(phaseOf({ ...done, onboardingDoneAt: null })).toBeNull();
});
