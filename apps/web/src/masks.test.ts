import { expect, test } from 'vitest';
import { parseCents } from './format';
import { maskCents, maskCep, maskCnpj, maskCpf, maskPhone } from './masks';

test('an amount fills from the right, like a cash register', () => {
  expect(maskCents('1')).toBe('0,01');
  expect(maskCents('12')).toBe('0,12');
  expect(maskCents('1234')).toBe('12,34');
  expect(maskCents('123456')).toBe('1.234,56');
  expect(maskCents('')).toBe('');
});

test('an amount ignores what is not a digit, so editing a masked value keeps working', () => {
  expect(maskCents('1.234,567')).toBe('12.345,67');
  expect(maskCents('1.234,5')).toBe('123,45');
  expect(maskCents('0,001')).toBe('0,01');
  expect(maskCents('0,00')).toBe('');
  expect(maskCents('R$ 12a3')).toBe('1,23');
});

test('a masked amount is what parseCents reads', () => {
  expect(parseCents(maskCents('123456'))).toBe(123456);
});

test('an amount stops at 13 digits', () => {
  expect(maskCents('12345678901234')).toBe('12.345.678.901,23');
});

test('a CNPJ is punctuated while it is typed, letters in upper case', () => {
  expect(maskCnpj('12')).toBe('12');
  expect(maskCnpj('123')).toBe('12.3');
  expect(maskCnpj('123456')).toBe('12.345.6');
  expect(maskCnpj('123456780')).toBe('12.345.678/0');
  expect(maskCnpj('1234567800019')).toBe('12.345.678/0001-9');
  expect(maskCnpj('12345678000195')).toBe('12.345.678/0001-95');
  expect(maskCnpj('12.abc.345/01de-35')).toBe('12.ABC.345/01DE-35');
  expect(maskCnpj('123456780001950')).toBe('12.345.678/0001-95');
});

test('a CPF, a CEP and a Brazilian phone are punctuated while they are typed', () => {
  expect(maskCpf('1234')).toBe('123.4');
  expect(maskCpf('12345678901')).toBe('123.456.789-01');
  expect(maskCep('80010')).toBe('80010');
  expect(maskCep('80010000')).toBe('80010-000');
  expect(maskPhone('41')).toBe('(41');
  expect(maskPhone('413333')).toBe('(41) 3333');
  expect(maskPhone('4133334444')).toBe('(41) 3333-4444');
  expect(maskPhone('41999998888')).toBe('(41) 99999-8888');
  expect(maskPhone('')).toBe('');
  expect(maskPhone('+55 43 99999-8888')).toBe('(43) 99999-8888');
});
