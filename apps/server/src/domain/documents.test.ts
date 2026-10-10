import { expect, test } from 'vitest';
import { isValidCnpj, isValidCpf } from './documents';

test('a CPF with right check digits is valid', () => {
  expect(isValidCpf('52998224725')).toBe(true);
  expect(isValidCpf('11144477735')).toBe(true);
});

test('a CPF with a wrong digit, equal digits, or a wrong length is invalid', () => {
  expect(isValidCpf('52998224724')).toBe(false);
  expect(isValidCpf('11111111111')).toBe(false);
  expect(isValidCpf('5299822472')).toBe(false);
  expect(isValidCpf('529.982.247-25')).toBe(false);
});

test('a CNPJ with right check digits is valid', () => {
  expect(isValidCnpj('12345678000195')).toBe(true);
  expect(isValidCnpj('11222333000181')).toBe(true);
});

test('an alphanumeric CNPJ uses the character values for the digits', () => {
  // Example of the Receita Federal note on the alphanumeric CNPJ.
  expect(isValidCnpj('12ABC34501DE35')).toBe(true);
  expect(isValidCnpj('12ABC34501DE36')).toBe(false);
});

test('a CNPJ with a wrong digit, equal digits, or a wrong length is invalid', () => {
  expect(isValidCnpj('12345678000190')).toBe(false);
  expect(isValidCnpj('98765432000110')).toBe(false);
  expect(isValidCnpj('00000000000000')).toBe(false);
  expect(isValidCnpj('1234567800019')).toBe(false);
  expect(isValidCnpj('12abc34501de35')).toBe(false);
});
