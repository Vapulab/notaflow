const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatCents(cents: number): string {
  return money.format(cents / 100);
}

// Timestamps arrive in UTC; the day that matters to the user is the Brasília day.
const brasiliaDay = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function formatDate(value: string | null): string {
  if (!value) return '';
  return brasiliaDay.format(new Date(value));
}

export function formatCompetence(value: string): string {
  const [year, month] = value.split('-');
  return `${month}/${year}`;
}

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

const brasiliaIso = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function brasiliaToday(now: Date = new Date()): string {
  return brasiliaIso.format(now);
}

// The usual competence: the last day of the month before the issue.
export function previousMonthEnd(today: string): string {
  const [year, month] = today.split('-').map(Number);
  const end = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 0));
  return end.toISOString().slice(0, 10);
}

// Accepts "1.234,56" (Brazilian) and "1234.56"; anything else is null.
export function parseCents(text: string): number | null {
  const value = text.trim();
  const brazilian = /^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(value);
  const plain = /^\d+(\.\d{1,2})?$/.test(value);
  if (!brazilian && !plain) return null;
  const normalized = brazilian && !plain ? value.replace(/\./g, '').replace(',', '.') : value;
  const [whole = '0', fraction = ''] = normalized.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

const plainAmount = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function centsInput(cents: number): string {
  return plainAmount.format(cents / 100);
}

const brasiliaDateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(value: string | null): string {
  if (!value) return '';
  return brasiliaDateTime.format(new Date(value)).replace(',', '');
}

// Percents are integer hundredths, like amounts in cents: 600 is 6,00%.
export function percentInput(hundredths: number): string {
  return centsInput(hundredths);
}

export function parsePercent(text: string): number | null {
  const value = parseCents(text);
  return value !== null && value <= 10_000 ? value : null;
}

export function formatServiceCode(code: string): string {
  return code.replace(/^(\d{2})(\d{2})(\d{2})$/, '$1.$2.$3');
}
