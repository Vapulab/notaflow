import { expect, test } from 'vitest';
import { serviceBody } from './ServiceDialog';

const text = (codes: { operationCode: string; cst: string; classCode: string }) => ({
  name: 'Suporte',
  description: 'Suporte técnico',
  municipalTaxCode: '',
  nbsCode: '',
  pisCofinsCst: '',
  ...codes,
});
const noExport = {
  mode: '',
  providerLink: '',
  providerSupport: '',
  customerSupport: '',
  temporaryGoods: '',
  mdic: '',
};

test('the IBS/CBS codes equal to the defaults of the item are not stored', () => {
  const body = serviceBody(
    '010701',
    text({ operationCode: '050101', cst: '000', classCode: '000001' }),
    noExport,
  );
  expect(body).not.toHaveProperty('ibsCbs');
});

test('a changed IBS/CBS code is stored as a group', () => {
  const body = serviceBody(
    '010701',
    text({ operationCode: '050101', cst: '000', classCode: '200003' }),
    noExport,
  );
  expect(body.ibsCbs).toEqual({ operationCode: '050101', cst: '000', classCode: '200003' });
});

test('a service with export details stores its codes even when they equal the defaults', () => {
  const exp = {
    mode: '1',
    providerLink: '0',
    providerSupport: '01',
    customerSupport: '01',
    temporaryGoods: '0',
    mdic: '0',
  };
  const body = serviceBody(
    '010701',
    text({ operationCode: '050101', cst: '000', classCode: '000001' }),
    exp,
  );
  expect(body.ibsCbs).toEqual({ operationCode: '050101', cst: '000', classCode: '000001' });
});
