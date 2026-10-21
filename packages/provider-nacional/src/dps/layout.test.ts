import { expect, test } from 'vitest';
import { dpsLayout } from './layout';

test('produção restrita has the NT 009 layout from 2026-10-20', () => {
  expect(dpsLayout('producao_restrita', new Date('2026-10-19T23:59:59-03:00'))).toBe('nt004');
  expect(dpsLayout('producao_restrita', new Date('2026-10-20T00:00:00-03:00'))).toBe('nt009');
});

test('production keeps the NT 004 layout until 2026-11-30, Brasília time', () => {
  expect(dpsLayout('producao', new Date('2026-11-30T23:59:59-03:00'))).toBe('nt004');
  expect(dpsLayout('producao', new Date('2026-12-01T00:00:00-03:00'))).toBe('nt009');
});
