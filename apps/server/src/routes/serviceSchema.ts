// JSON schema of a service's fiscal fields, shared by the services routes and the complete-mode overrides.
export const digits = (n: number) => ({ type: 'string', pattern: `^[0-9]{${n}}$` });

export const serviceProperties = {
  name: { type: 'string', minLength: 1, maxLength: 100 },
  nationalTaxCode: digits(6),
  municipalTaxCode: digits(3),
  nbsCode: digits(9),
  description: { type: 'string', minLength: 1, maxLength: 2000 },
  pisCofinsCst: digits(2),
  ibsCbs: {
    type: 'object',
    additionalProperties: false,
    required: ['operationCode', 'cst', 'classCode'],
    properties: { operationCode: digits(6), cst: digits(3), classCode: digits(6) },
  },
  export: {
    type: 'object',
    additionalProperties: false,
    required: [
      'mode',
      'providerLink',
      'providerSupport',
      'customerSupport',
      'temporaryGoods',
      'mdic',
    ],
    properties: {
      mode: { enum: ['0', '1', '2', '3', '4'] },
      providerLink: { enum: ['0', '1', '2', '3', '4', '5', '6'] },
      providerSupport: digits(2),
      customerSupport: digits(2),
      temporaryGoods: { enum: ['0', '1', '2', '3'] },
      mdic: { enum: ['0', '1'] },
    },
  },
} as const;
