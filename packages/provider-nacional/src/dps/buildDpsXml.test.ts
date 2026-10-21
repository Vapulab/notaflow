import { loadCertificate, NodeSigner } from '@notaflow/signer-node';
import { makeTestCertificate } from '@notaflow/test-kit';
import { describe, expect, test } from 'vitest';
import { validateAgainstXsd } from '../../test/xsd';
import { buildDpsId } from './buildDpsId';
import { buildDpsXml } from './buildDpsXml';
import type { DpsInput } from './types';

const base: DpsInput = {
  environment: 'producao_restrita',
  issuedAt: new Date('2026-10-08T18:00:00Z'),
  appVersion: 'notaflow-0.0.0',
  series: '900',
  number: 1,
  competence: '2026-10-01',
  emitterMunicipality: '3550308',
  provider: {
    cnpj: '12345678000195',
    municipalRegistration: '1234567',
    simplesNacional: '1',
    specialRegime: '0',
  },
  customer: {
    document: { type: 'CNPJ', value: '98765432000110' },
    name: 'Cliente Exemplo Ltda',
    email: 'financeiro@example.com',
    address: {
      municipality: '3550308',
      zip: '01310100',
      street: 'Av. Paulista',
      number: '1000',
      district: 'Bela Vista',
    },
  },
  service: {
    municipality: '3550308',
    nationalTaxCode: '010101',
    description: 'Consultoria em análise & ção <teste>',
    nbsCode: '115022000',
  },
  amounts: { serviceCents: 150000 },
  tax: { issqnTaxation: '1', issRetention: '1' },
};

describe('buildDpsId', () => {
  test('builds the 45-character id', () => {
    const id = buildDpsId({
      municipality: '3550308',
      cnpj: '12345678000195',
      series: '900',
      number: 1,
    });
    expect(id).toBe('DPS355030821234567800019500900000000000000001');
    expect(id).toHaveLength(45);
  });

  test('accepts an alphanumeric CNPJ', () => {
    expect(
      buildDpsId({ municipality: '3550308', cnpj: 'AB345678000195', series: '1', number: 7 }),
    ).toHaveLength(45);
  });

  test('rejects a municipality that is not 7 digits', () => {
    expect(() =>
      buildDpsId({ municipality: '355', cnpj: '12345678000195', series: '1', number: 1 }),
    ).toThrow(RangeError);
  });
});

describe('buildDpsXml', () => {
  test('produces a DPS that validates against DPS_v1.01.xsd', () => {
    const result = validateAgainstXsd(buildDpsXml(base).xml, 'DPS_v1.01.xsd');
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test('validates without the optional customer, address, and NBS', () => {
    const { customer: _customer, ...noCustomer } = base;
    const input: DpsInput = {
      ...noCustomer,
      service: { municipality: '3550308', nationalTaxCode: '010101', description: 'Serviço' },
    };
    expect(validateAgainstXsd(buildDpsXml(input).xml, 'DPS_v1.01.xsd').errors).toEqual([]);
  });

  test('writes the fields the Sefin reads first', () => {
    const { id, xml } = buildDpsXml(base);
    expect(id).toBe(
      buildDpsId({ municipality: '3550308', cnpj: '12345678000195', series: '900', number: 1 }),
    );
    expect(xml).toContain(`<infDPS Id="${id}">`);
    expect(xml).toContain('<tpAmb>2</tpAmb>');
    expect(xml).toContain('<dhEmi>2026-10-08T15:00:00-03:00</dhEmi>');
    expect(xml).toContain('<vServ>1500.00</vServ>');
    expect(xml).toContain('Consultoria em análise &amp; ção &lt;teste&gt;');
  });

  test('writes the retained INSS after PIS and COFINS, valid against the XSD', () => {
    const { xml } = buildDpsXml({
      ...base,
      tax: { ...base.tax, pisCofins: { cst: '00', retention: '0' }, cpRetainedCents: 16500 },
    });
    expect(xml).toContain('<tpRetPisCofins>0</tpRetPisCofins></piscofins><vRetCP>165.00</vRetCP>');
    expect(validateAgainstXsd(xml, 'DPS_v1.01.xsd').errors).toEqual([]);
  });

  test('writes tribFed for a retained INSS without PIS and COFINS', () => {
    const { xml } = buildDpsXml({ ...base, tax: { ...base.tax, cpRetainedCents: 100 } });
    expect(xml).toContain('<tribFed><vRetCP>1.00</vRetCP></tribFed>');
    expect(validateAgainstXsd(xml, 'DPS_v1.01.xsd').errors).toEqual([]);
  });

  test('uses tpAmb 1 in production', () => {
    expect(buildDpsXml({ ...base, environment: 'producao' }).xml).toContain('<tpAmb>1</tpAmb>');
  });

  test('a signed DPS validates against the XSD', async () => {
    const testCert = makeTestCertificate();
    const certificate = loadCertificate(testCert.pfx, testCert.password);
    const signed = await new NodeSigner().sign({
      xml: buildDpsXml(base).xml,
      elementName: 'infDPS',
      certificate,
      profile: 'rsa-sha1-c14n',
    });
    expect(validateAgainstXsd(signed, 'DPS_v1.01.xsd').errors).toEqual([]);
  });
});

describe('buildDpsXml for a service exported to a foreign customer', () => {
  const exportInput: DpsInput = {
    ...base,
    emitterMunicipality: '4113700',
    provider: {
      cnpj: '12345678000195',
      simplesNacional: '3',
      simplesRegime: '1',
      specialRegime: '0',
    },
    customer: {
      document: { type: 'NIF', value: '00-0000000' },
      name: 'Foreign Customer Inc',
      address: {
        country: 'US',
        postalCode: '99999',
        city: 'Testville',
        region: 'NY',
        street: '1 Example Street',
        number: '1',
        district: 'Downtown',
      },
    },
    service: {
      municipality: '4113700',
      nationalTaxCode: '010701',
      description: 'Serviços de tecnologia da informação para tomador no exterior',
      nbsCode: '115080000',
      foreignTrade: {
        mode: '1',
        providerLink: '0',
        currency: '220',
        amountInCurrencyCents: 20000,
        providerSupport: '02',
        customerSupport: '02',
        temporaryGoods: '1',
        mdic: '0',
      },
    },
    amounts: { serviceCents: 100000 },
    tax: {
      issqnTaxation: '3',
      resultCountry: 'US',
      issRetention: '1',
      pisCofins: { cst: '00', retention: '0' },
      simplesTotalPercent: '6.00',
    },
    ibsCbs: {
      purpose: '0',
      finalConsumer: '0',
      operationCode: '100302',
      destination: '0',
      cst: '410',
      classCode: '410027',
    },
  };

  test('validates against DPS_v1.01.xsd', () => {
    expect(validateAgainstXsd(buildDpsXml(exportInput).xml, 'DPS_v1.01.xsd').errors).toEqual([]);
  });

  test('writes the foreign customer, the export group, and the IBS/CBS group', () => {
    const { xml } = buildDpsXml(exportInput);
    expect(xml).toContain('<toma><NIF>00-0000000</NIF><xNome>Foreign Customer Inc</xNome>');
    expect(xml).toContain(
      '<endExt><cPais>US</cPais><cEndPost>99999</cEndPost><xCidade>Testville</xCidade><xEstProvReg>NY</xEstProvReg></endExt>',
    );
    expect(xml).toContain('<comExt><mdPrestacao>1</mdPrestacao>');
    expect(xml).toContain('<vServMoeda>200.00</vServMoeda>');
    expect(xml).toContain('<tribISSQN>3</tribISSQN><cPaisResult>US</cPaisResult>');
    expect(xml).toContain(
      '<tribFed><piscofins><CST>00</CST><tpRetPisCofins>0</tpRetPisCofins></piscofins></tribFed>',
    );
    expect(xml).toContain('<totTrib><pTotTribSN>6.00</pTotTribSN></totTrib>');
    expect(xml).toContain(
      '<IBSCBS><finNFSe>0</finNFSe><indFinal>0</indFinal><cIndOp>100302</cIndOp><indDest>0</indDest><valores><trib><gIBSCBS><CST>410</CST><cClassTrib>410027</cClassTrib></gIBSCBS></trib></valores></IBSCBS>',
    );
  });
});

test('the XSD check rejects a DPS with elements out of order', () => {
  const { xml } = buildDpsXml(base);
  const swapped = xml.replace(/(<tpAmb>.*?<\/tpAmb>)(<dhEmi>.*?<\/dhEmi>)/, '$2$1');
  const result = validateAgainstXsd(swapped, 'DPS_v1.01.xsd');
  expect(result.valid).toBe(false);
  expect(result.errors.join(' ')).toContain('dhEmi');
});
