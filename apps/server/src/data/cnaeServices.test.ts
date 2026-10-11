import { expect, test } from 'vitest';
import { suggestedGroups, suggestedServiceCodes } from './cnaeServices';

test.each([
  [['6201501'], ['01']],
  [['6311900'], ['01', '17']],
  [['7020400'], ['17']],
  [['4611700'], ['10']],
  [['8599604'], ['08']],
  [['8630503'], ['04']],
  [['4120400'], ['07']],
  [['9511800'], ['14']],
])('CNAE %s suggests the list groups %s', (cnaes, groups) => {
  expect(suggestedGroups(cnaes)).toEqual(groups);
});

test('a CNAE outside services, such as retail, suggests nothing', () => {
  expect(suggestedGroups(['4711302'])).toEqual([]);
});

test('several CNAEs give their groups once, in the order of the CNAEs', () => {
  expect(suggestedGroups(['6201501', '6202300', '7319002'])).toEqual(['01', '17', '23']);
});

test('the suggested codes are the codes of those groups, group by group', () => {
  const codes = suggestedServiceCodes(['7319002', '6201501']);
  const groups = [...new Set(codes.map((c) => c.code.slice(0, 2)))];
  expect(groups).toEqual(['17', '23', '01']);
  expect(codes.some((c) => c.code === '010101')).toBe(true);
});
