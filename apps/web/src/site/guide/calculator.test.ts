// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mountCalculator, parseMonth } from './calculator';

const text = (element: Element | null) => (element?.textContent ?? '').replace(/\s+/g, ' ');

let root: HTMLElement;

function field<T extends HTMLElement = HTMLInputElement>(name: string): T {
  const element = root.querySelector<T>(`[name="${name}"]`);
  if (!element) throw new Error(`no field ${name}`);
  return element;
}

function type(name: string, value: string) {
  const input = field<HTMLInputElement | HTMLSelectElement>(name);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function history(value: string) {
  for (const input of root.querySelectorAll<HTMLInputElement>('input[name^="history-"]')) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function calculate() {
  const form = root.querySelector('form');
  if (!form) throw new Error('no form');
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

const result = () => root.querySelector('[data-result]');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  document.body.innerHTML = '<div data-calculator></div>';
  const element = document.querySelector<HTMLElement>('[data-calculator]');
  if (!element) throw new Error('no root');
  root = element;
  mountCalculator(root);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function anexoIIIMonth() {
  type('annex-mode', 'III');
  history('10.000,00');
  type('revenue-normal', '10.000,00');
}

test('one normal line in Anexo III, band 1: the rate, the DAS, and the formula with the numbers', () => {
  anexoIIIMonth();
  calculate();
  const shown = text(result());
  expect(root.querySelectorAll('input[name^="history-"]')).toHaveLength(12);
  expect(shown).toContain('6,00%');
  expect(shown).toContain('R$ 600,00');
  expect(shown).toContain('(R$ 120.000,00 × 6,00% − R$ 0,00) ÷ R$ 120.000,00 = 6,00%');
  expect(shown).toContain('Faixa 1');
});

test('the calculator makes no network call', () => {
  anexoIIIMonth();
  type('today-rate', '8,00');
  calculate();
  expect(fetch).not.toHaveBeenCalled();
});

test('a bad money field shows a field error and no result', () => {
  anexoIIIMonth();
  type('revenue-normal', 'abc');
  calculate();
  expect(text(root.querySelector('[data-error-for="revenue-normal"]'))).toContain('Valor inválido');
  expect(text(result())).toBe('');
});

test('the CNAE hint says it is a suggestion', () => {
  type('cnae', '6201-5/01');
  expect(text(root)).toContain('sugestão: confirme com seu contador');
  expect(root.querySelector<HTMLInputElement>('#q-fator_r_listed-yes')?.checked).toBe(true);
});

test('an RBT12 above R$ 4,8 mi shows the exit text and no result', () => {
  type('annex-mode', 'III');
  history('500.000,00');
  type('revenue-normal', '10.000,00');
  calculate();
  expect(text(root.querySelector('[data-outcome]'))).toContain('sai do Simples Nacional');
  expect(text(result())).toBe('');
});

test('the activities section is closed by default', () => {
  const details = root.querySelector<HTMLDetailsElement>('details[data-step="activities"]');
  expect(details?.open).toBe(false);
  expect(text(details?.querySelector('summary') ?? null)).toContain('Tenho mais de uma atividade');
});

test('the comparison with a rate paid today shows the difference and the neutral text', () => {
  anexoIIIMonth();
  type('today-rate', '8,00');
  calculate();
  const shown = text(result());
  expect(shown).toContain('R$ 200,00');
  expect(shown).toContain(
    'A diferença pode ter um motivo, como uma atividade em outro Anexo. Leve este cálculo ao seu contador.',
  );
});

test('the Fator R under 28% moves the activity to Anexo V', () => {
  type('annex-mode', 'fator_r');
  history('10.000,00');
  type('revenue-normal', '10.000,00');
  type('payroll-salaries', '30.000,00');
  calculate();
  const shown = text(result());
  expect(shown).toContain('0,25');
  expect(shown).toContain('Anexo V');
  expect(shown).toContain('15,50%');
});

test('answers that do not decide the Anexo give no result', () => {
  history('10.000,00');
  type('revenue-normal', '10.000,00');
  calculate();
  expect(text(root.querySelector('[data-outcome]'))).toContain('não decidem o Anexo');
  expect(text(result())).toBe('');
});

test('a year revenue more than 20% above the sublimit is a warning, not a calculation', () => {
  anexoIIIMonth();
  type('year-revenue', '4.400.000,00');
  calculate();
  expect(text(root.querySelector('[data-outcome]'))).toContain('confirme com seu contador');
  expect(text(result())).toBe('');
});

test('a fixed ISS is a warning, not a calculation', () => {
  anexoIIIMonth();
  field('fixed-iss').click();
  calculate();
  expect(text(root.querySelector('[data-outcome]'))).toContain('valor fixo');
  expect(text(result())).toBe('');
});

test('band 6 asks where the ISS goes before it calculates', () => {
  type('annex-mode', 'III');
  history('350.000,00');
  type('revenue-normal', '10.000,00');
  expect(field<HTMLSelectElement>('band6-iss').closest('[hidden]')).toBeNull();
  calculate();
  expect(text(root.querySelector('[data-error-for="band6-iss"]'))).not.toBe('');
  type('band6-iss', 'outside');
  calculate();
  expect(text(result())).toContain('Faixa 6');
});

test('a second activity in another Anexo adds its own line with the same RBT12', () => {
  anexoIIIMonth();
  const add = root.querySelector<HTMLButtonElement>('[data-add-activity]');
  add?.click();
  type('activity-1-annex', 'IV');
  type('activity-1-revenue', '10.000,00');
  calculate();
  const shown = text(result());
  expect(shown).toContain('Anexo IV');
  expect(shown).toContain('4,50%');
  // Each tax is rounded to the cent: Anexo IV gives R$ 450,01, plus R$ 600,00 of the Anexo III line.
  expect(shown).toContain('R$ 1.050,01');
});

function retainedMonth(rule: string) {
  type('annex-mode', 'III');
  history('10.000,00');
  type('revenue-retained', '10.000,00');
  type('retained-history', '10.000,00');
  root.querySelector<HTMLInputElement>(`input[name="retained-rule"][value="${rule}"]`)?.click();
  calculate();
  return text(result());
}

test('a retained ISS line takes the ISS out of the DAS and shows the rate by the rule', () => {
  const shown = retainedMonth('rule');
  // Anexo III band 1: ISS share 33,50% of 6,00% is 2,01%; the DAS keeps 3,99%.
  expect(shown).toContain('3,99%');
  expect(shown).toContain('o cliente retém R$ 201,00 de ISS, à alíquota de 2,01%');
});

test.each([
  ['first_month', 'R$ 200,00 de ISS, à alíquota de 2,00%'],
  ['not_on_invoice', 'R$ 500,00 de ISS, à alíquota de 5,00%'],
])('the retained ISS option %s uses its fixed rate', (rule, expected) => {
  expect(retainedMonth(rule)).toContain(expected);
});

test('an export line uses its own RBT12 and leaves out ISS, PIS and Cofins', () => {
  type('annex-mode', 'III');
  history('10.000,00');
  type('revenue-export', '10.000,00');
  calculate();
  const shown = text(result());
  expect(shown).toContain('Receita de exportação dos 12 meses: R$ 0,00');
  // IRPJ 0,24% + CSLL 0,21% + CPP 2,604% of R$ 10.000,00.
  expect(shown).toContain('DAS do mês: R$ 305,40');
});

test('a company under 13 months uses the average of its months × 12', () => {
  type('annex-mode', 'III');
  type('month', '2026-05');
  type('activity-start', '2026-02');
  const cells = root.querySelectorAll<HTMLInputElement>('input[name^="history-"]');
  expect(cells).toHaveLength(3);
  ['10.000,00', '20.000,00', ''].forEach((value, i) => {
    const cell = cells[i];
    if (cell) cell.value = value;
  });
  type('revenue-normal', '10.000,00');
  calculate();
  const shown = text(result());
  expect(shown).toContain('R$ 120.000,00, a média de 3 meses (02/2026 a 04/2026) × 12');
});

test('the first month of activity uses the revenue of the month × 12', () => {
  type('annex-mode', 'III');
  type('month', '2026-05');
  type('activity-start', '2026-05');
  expect(root.querySelectorAll('input[name^="history-"]')).toHaveLength(0);
  type('revenue-normal', '10.000,00');
  calculate();
  expect(text(result())).toContain('R$ 120.000,00, a receita do primeiro mês × 12');
});

test('an activity start after the month is a field error, with no crash while typing', () => {
  type('annex-mode', 'III');
  type('month', '2026-05');
  type('activity-start', '2026-08');
  type('revenue-normal', '10.000,00');
  calculate();
  expect(text(root.querySelector('[data-error-for="activity-start"]'))).toContain('depois');
  expect(text(result())).toBe('');
});

test('the pasted list fills the months, oldest first; a bad list is a field error', () => {
  type('annex-mode', 'III');
  type('history-paste', Array.from({ length: 12 }, () => '10.000,00').join('\n'));
  root.querySelector<HTMLButtonElement>('[data-paste]')?.click();
  type('revenue-normal', '10.000,00');
  calculate();
  expect(text(result())).toContain('DAS do mês: R$ 600,00');
  type('history-paste', 'abc');
  root.querySelector<HTMLButtonElement>('[data-paste]')?.click();
  expect(text(root.querySelector('[data-error-for="history-paste"]'))).toContain('Cole até 12');
});

test('a retained ISS window above R$ 4,8 mi shows the exit text, not a crash', () => {
  type('annex-mode', 'III');
  type('revenue-retained', '10.000,00');
  type('retained-history', '5.000.000,00');
  calculate();
  expect(text(root.querySelector('[data-outcome]'))).toContain('sai do Simples Nacional');
  expect(text(result())).toBe('');
});

test('an empty history says that the RBT12 is R$ 0,00', () => {
  type('annex-mode', 'III');
  type('revenue-normal', '10.000,00');
  calculate();
  expect(text(result())).toContain('a receita dos 12 meses é R$ 0,00 e conta como R$ 1,00');
});

test('the CNAE suggestion keeps the answers the reader chose', () => {
  root.querySelector<HTMLInputElement>('#q-intellectual-yes')?.click();
  type('cnae', '6201-5/01');
  expect(root.querySelector<HTMLInputElement>('#q-intellectual-yes')?.checked).toBe(true);
  expect(root.querySelector<HTMLInputElement>('#q-fator_r_listed-yes')?.checked).toBe(true);
});

test('labor assignment outside Anexo IV says the company leaves the Simples', () => {
  type('cnae', '6201-5/01');
  root.querySelector<HTMLInputElement>('#q-labor-yes')?.click();
  history('10.000,00');
  type('revenue-normal', '10.000,00');
  calculate();
  expect(text(root.querySelector('[data-outcome]'))).toContain(
    'Ceder mão de obra fora das atividades do Anexo IV exclui a empresa do Simples',
  );
});

test('a DAS that differs from rate × revenue by a cent explains the rounding', () => {
  type('annex-mode', 'IV');
  history('10.000,00');
  type('revenue-normal', '10.000,00');
  calculate();
  expect(text(result())).toContain(
    'A soma fica R$ 0,01 acima de 4,50% × R$ 10.000,00 porque o PGDAS-D arredonda cada imposto ao centavo',
  );
});

test('with both comparison fields, the page says it uses the DAS', () => {
  anexoIIIMonth();
  type('today-das', '700,00');
  type('today-rate', '8,00');
  calculate();
  const shown = text(result());
  expect(shown).toContain('a comparação usa o valor do DAS');
  expect(shown).toContain('Diferença: R$ 100,00 a mais');
});

test('parseMonth accepts AAAA-MM and MM/AAAA', () => {
  expect(parseMonth('2026-09')).toBe('2026-09');
  expect(parseMonth('09/2026')).toBe('2026-09');
  expect(parseMonth('9/2026')).toBe('2026-09');
  expect(parseMonth('13/2026')).toBeNull();
  expect(parseMonth('')).toBeNull();
});
