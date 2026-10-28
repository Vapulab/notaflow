import { describe, expect, test } from 'vitest';
import anexo8 from './anexo8.json';
import { ibsCbsDefaults } from './ibsCbsDefaults';

describe('ibsCbsDefaults', () => {
  test('systems analysis (01.01) is taxed in full at the buyer domicile', () => {
    expect(ibsCbsDefaults('010101')).toEqual({
      operationCode: '100301',
      cst: '000',
      classCode: '000001',
    });
  });

  test('an item whose INDOP is a place-of-service code gives that code', () => {
    expect(ibsCbsDefaults('010700')).toEqual({
      operationCode: '050101',
      cst: '000',
      classCode: '000001',
    });
  });

  test('the CST is the first 3 digits of the class code', () => {
    expect(ibsCbsDefaults('030300').cst).toBe('200');
  });

  test('an unknown item gives the fallback', () => {
    expect(ibsCbsDefaults('999999')).toEqual({
      operationCode: '100301',
      cst: '000',
      classCode: '000001',
    });
  });

  test('an item with an INDOP but no class code keeps its INDOP and gets class 000001', () => {
    expect(ibsCbsDefaults('040200')).toEqual({
      operationCode: '030101',
      cst: '000',
      classCode: '000001',
    });
  });

  test('every JSON entry has a 6-digit operation code and class code', () => {
    const entries = Object.entries(anexo8);
    expect(entries.length).toBeGreaterThan(100);
    for (const [key, value] of entries) {
      expect(key).toMatch(/^\d{4}$/);
      expect(value.operationCode).toMatch(/^\d{6}$/);
      expect(value.classCode).toMatch(/^\d{6}$/);
    }
  });
});
