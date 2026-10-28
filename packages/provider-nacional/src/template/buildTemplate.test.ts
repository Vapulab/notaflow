import type { NewInvoiceInput } from '@notaflow/core';
import { describe, expect, test } from 'vitest';
import { readFixture } from '../../test/fixtures';
import { validateAgainstXsd } from '../../test/xsd';
import { buildDpsXml } from '../dps/buildDpsXml';
import { buildTemplate } from './buildTemplate';
import type { DpsLayout } from '../dps/layout';
import { readTemplate, type DpsTemplate } from './readTemplate';

const domestic: NewInvoiceInput = {
  competence: '2026-10-31',
  emitter: {
    cnpj: '12345678000195',
    municipality: '4113700',
    simplesNacional: '3',
    simplesRegime: '1',
    specialRegime: '0',
  },
  service: {
    nationalTaxCode: '010701',
    nbsCode: '115080000',
    description: 'Desenvolvimento de software',
    pisCofinsCst: '00',
  },
  customer: {
    document: { type: 'CNPJ', value: '11222333000181' },
    name: 'Cliente Teste Ltda',
    address: {
      kind: 'domestic',
      municipality: '4113700',
      zip: '86010000',
      street: 'Rua Teste',
      number: '1',
      district: 'Centro',
    },
  },
  serviceCents: 123400,
  simplesPercent: 600,
  issRate: 200,
};

const abroad: NewInvoiceInput = {
  ...domestic,
  service: {
    ...domestic.service,
    ibsCbs: { operationCode: '100302', cst: '410', classCode: '410027' },
    export: {
      mode: '1',
      providerLink: '0',
      providerSupport: '02',
      customerSupport: '02',
      temporaryGoods: '1',
      mdic: '0',
    },
  },
  customer: {
    document: { type: 'NIF', value: '00-0000000' },
    name: 'Foreign Customer Inc',
    address: {
      kind: 'foreign',
      country: 'US',
      postalCode: '99999',
      city: 'Testville',
      region: 'NY',
      street: '1 Example Street',
      number: '1',
      district: 'Downtown',
    },
  },
  serviceCents: 670321,
  foreign: { currencyCode: '220', amountCents: 123400 },
};

// Production on 2026-11-30 still has NT 004; produção restrita on 2026-10-31 has NT 009 release 1.
const LAYOUTS = {
  nt004: { environment: 'producao' as const, issuedAt: new Date('2026-11-30T12:00:00Z') },
  nt009: { environment: 'producao_restrita' as const, issuedAt: new Date('2026-10-31T12:00:00Z') },
};

function dpsXml(template: DpsTemplate, layout: DpsLayout): string {
  const { serviceCents, ...rest } = template;
  return buildDpsXml({
    ...rest,
    ...LAYOUTS[layout],
    appVersion: 'notaflow-test',
    series: '900',
    number: 7,
    competence: '2026-10-31',
    amounts: { serviceCents },
  }).xml;
}

// The built DPS inside a real NFS-e envelope reads back as the same template.
function roundTrip(template: DpsTemplate, layout: DpsLayout): DpsTemplate {
  const envelope = readFixture('NFSE_EXPORT_FULL.xml');
  return readTemplate(envelope.replace(/<DPS [\s\S]*<\/DPS>/, dpsXml(template, layout)));
}

function expectValidAndInverse(template: DpsTemplate) {
  for (const layout of ['nt004', 'nt009'] as const) {
    expect(validateAgainstXsd(dpsXml(template, layout), 'DPS_v1.01.xsd', layout).errors).toEqual(
      [],
    );
  }
  // Under NT 004 a domestic invoice carries no IBSCBS group, so a copy has none either.
  const { ibsCbs: nt004Group, ...noGroup } = template;
  expect(roundTrip(template, 'nt004')).toEqual(
    template.service.foreignTrade || !nt004Group ? template : noGroup,
  );
  // NT 009 has no cIndOp for an export (CST 410), so that copy keeps everything else.
  const { ibsCbs, ...rest } = template;
  const withoutOperation =
    ibsCbs?.cst === '410' ? { ...rest, ibsCbs: { ...ibsCbs, operationCode: undefined } } : template;
  expect(roundTrip(template, 'nt009')).toEqual(JSON.parse(JSON.stringify(withoutOperation)));
}

describe('buildTemplate', () => {
  test('a Brazil CNPJ customer is taxable in the municipality, with no rate unless retained', () => {
    const template = buildTemplate(domestic);
    expect(template).toEqual({
      emitterMunicipality: '4113700',
      provider: {
        cnpj: '12345678000195',
        simplesNacional: '3',
        simplesRegime: '1',
        specialRegime: '0',
      },
      customer: {
        document: { type: 'CNPJ', value: '11222333000181' },
        name: 'Cliente Teste Ltda',
        address: {
          municipality: '4113700',
          zip: '86010000',
          street: 'Rua Teste',
          number: '1',
          district: 'Centro',
        },
      },
      service: {
        municipality: '4113700',
        nationalTaxCode: '010701',
        description: 'Desenvolvimento de software',
        nbsCode: '115080000',
      },
      serviceCents: 123400,
      tax: {
        issqnTaxation: '1',
        issRetention: '1',
        pisCofins: { cst: '00', retention: '0' },
        simplesTotalPercent: '6.00',
      },
      ibsCbs: {
        purpose: '0',
        finalConsumer: '0',
        operationCode: '050101',
        destination: '0',
        cst: '000',
        classCode: '000001',
      },
    });
    expectValidAndInverse(template);
  });

  test('a domestic invoice takes the IBSCBS codes of its LC 116 item', () => {
    const service = { ...domestic.service, nationalTaxCode: '010101' };
    expect(buildTemplate({ ...domestic, service }).ibsCbs).toEqual({
      purpose: '0',
      finalConsumer: '0',
      operationCode: '100301',
      destination: '0',
      cst: '000',
      classCode: '000001',
    });
  });

  test('a CPF customer is a final consumer', () => {
    const customer = {
      ...domestic.customer,
      document: { type: 'CPF' as const, value: '11144477735' },
    };
    expect(buildTemplate({ ...domestic, customer }).ibsCbs?.finalConsumer).toBe('1');
  });

  test('the service codes win over the defaults on a domestic invoice', () => {
    const service = {
      ...domestic.service,
      ibsCbs: { operationCode: '100302', cst: '200', classCode: '200003' },
    };
    expect(buildTemplate({ ...domestic, service }).ibsCbs).toMatchObject({
      operationCode: '100302',
      cst: '200',
      classCode: '200003',
    });
  });

  test('a domestic DPS in production before NT 009 is byte-identical to the one before the IBSCBS group', () => {
    expect(dpsXml(buildTemplate(domestic), 'nt004')).toBe(readFixture('DPS_DOMESTIC_NT004.xml'));
  });

  test('a retained ISS writes tpRetISSQN 2 and the ISS rate', () => {
    const template = buildTemplate({ ...domestic, issRetained: true });
    expect(template.tax).toMatchObject({ issRetention: '2', issRatePercent: '2.00' });
    expectValidAndInverse(template);
  });

  test('a retained ISS below the legal minimum of its service is refused outside the Simples', () => {
    const regular = {
      ...domestic,
      emitter: { ...domestic.emitter, simplesNacional: '1' as const },
    };
    expect(() => buildTemplate({ ...regular, issRetained: true, issRate: 199 })).toThrow(
      RangeError,
    );
    const works = { ...domestic.service, nationalTaxCode: '070202' };
    expect(
      buildTemplate({ ...domestic, service: works, issRetained: true, issRate: 150 }).tax,
    ).toMatchObject({ issRatePercent: '1.50' });
  });

  test('a Simples ME or EPP retains the ISS share of its band, even below 2%', () => {
    expect(buildTemplate({ ...domestic, issRetained: true, issRate: 192 }).tax).toMatchObject({
      issRatePercent: '1.92',
    });
  });

  test('a retained INSS writes vRetCP and survives a copy', () => {
    const template = buildTemplate({ ...domestic, inssRetainedCents: 16500 });
    expect(template.tax.cpRetainedCents).toBe(16500);
    expectValidAndInverse(template);
  });

  test('a retained INSS is refused for a customer that is not a CNPJ', () => {
    const cpf = { ...domestic.customer, document: { type: 'CPF' as const, value: '11144477735' } };
    expect(() => buildTemplate({ ...domestic, customer: cpf, inssRetainedCents: 100 })).toThrow(
      RangeError,
    );
    expect(() => buildTemplate({ ...abroad, inssRetainedCents: 100 })).toThrow(RangeError);
  });

  test('a retained INSS must be above zero and below the service amount', () => {
    expect(() => buildTemplate({ ...domestic, inssRetainedCents: 0 })).toThrow(RangeError);
    expect(() => buildTemplate({ ...domestic, inssRetainedCents: domestic.serviceCents })).toThrow(
      RangeError,
    );
  });

  test('a retained ISS without a rate is refused', () => {
    const { issRate: _rate, ...noRate } = domestic;
    expect(() => buildTemplate({ ...noRate, issRetained: true })).toThrow(RangeError);
  });

  test('a CPF customer keeps its document type', () => {
    const template = buildTemplate({
      ...domestic,
      customer: { ...domestic.customer, document: { type: 'CPF', value: '11144477735' } },
    });
    expect(template.customer?.document).toEqual({ type: 'CPF', value: '11144477735' });
    expectValidAndInverse(template);
  });

  test('each Simples band is written as pTotTribSN', () => {
    expect(buildTemplate({ ...domestic, simplesPercent: 1120 }).tax.simplesTotalPercent).toBe(
      '11.20',
    );
  });

  test('a Brazil customer without a domestic address is refused', () => {
    const { address: _address, ...noAddress } = domestic.customer;
    expect(() => buildTemplate({ ...domestic, customer: noAddress })).toThrow(RangeError);
  });

  test('a customer abroad is an export with foreign trade and IBSCBS from the service', () => {
    const template = buildTemplate({ ...abroad, issRetained: true });
    expect(template.tax).toEqual({
      issqnTaxation: '3',
      resultCountry: 'US',
      issRetention: '1',
      // PIS and COFINS do not apply to an export of services, whatever the service says.
      pisCofins: { cst: '08', retention: '0' },
      simplesTotalPercent: '6.00',
    });
    expect(template.service.foreignTrade).toEqual({
      mode: '1',
      providerLink: '0',
      currency: '220',
      amountInCurrencyCents: 123400,
      providerSupport: '02',
      customerSupport: '02',
      temporaryGoods: '1',
      mdic: '0',
    });
    expect(template.ibsCbs).toEqual({
      purpose: '0',
      finalConsumer: '0',
      operationCode: '100302',
      destination: '0',
      cst: '410',
      classCode: '410027',
    });
    expectValidAndInverse(template);
  });

  test('a service without export details declares no foreign trade support (01) on either side', () => {
    const { export: _export, ...plain } = abroad.service;
    const template = buildTemplate({ ...abroad, service: plain });
    expect(template.service.foreignTrade).toMatchObject({
      mode: '1',
      providerLink: '0',
      providerSupport: '01',
      customerSupport: '01',
      temporaryGoods: '1',
      mdic: '0',
    });
    expectValidAndInverse(template);
  });

  test('an export without service codes has no IBSCBS group, as before', () => {
    const { ibsCbs: _codes, ...plain } = abroad.service;
    expect(buildTemplate({ ...abroad, service: plain }).ibsCbs).toBeUndefined();
  });

  test('an export without the foreign amount is refused', () => {
    const { foreign: _foreign, ...noForeign } = abroad;
    expect(() => buildTemplate(noForeign)).toThrow(RangeError);
  });

  test('a customer abroad without a foreign address is refused', () => {
    const { address: _address, ...noAddress } = abroad.customer;
    expect(() => buildTemplate({ ...abroad, customer: noAddress })).toThrow(RangeError);
  });

  test('a Brazil document with an address abroad, or an address abroad in BR, is refused', () => {
    const foreignAddress = abroad.customer.address;
    if (foreignAddress?.kind !== 'foreign') throw new Error('fixture');
    expect(() =>
      buildTemplate({
        ...domestic,
        customer: { ...domestic.customer, address: foreignAddress },
      }),
    ).toThrow(RangeError);
    expect(() =>
      buildTemplate({
        ...abroad,
        customer: { ...abroad.customer, address: { ...foreignAddress, country: 'BR' } },
      }),
    ).toThrow(RangeError);
  });

  test('a customer without a document is refused', () => {
    expect(() =>
      buildTemplate({ ...abroad, customer: { ...abroad.customer, document: null } }),
    ).toThrow(RangeError);
  });

  test('a zero amount is refused', () => {
    expect(() => buildTemplate({ ...domestic, serviceCents: 0 })).toThrow(RangeError);
  });

  test('a 2027 competence is refused', () => {
    expect(() => buildTemplate({ ...domestic, competence: '2027-01-04' })).toThrow(/2027/);
  });
});
