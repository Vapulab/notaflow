import { writeFileSync } from 'node:fs';
import {
  buildDpsXml,
  formatBrasiliaDate,
  ibsCbsDefaults,
  type DpsInput,
} from '@notaflow/provider-nacional';
import {
  appVersion,
  cancelInvoice,
  certificate,
  client,
  env,
  nodeSigner,
} from '../2026-10-sefin/session';

// Stage 2a check in produção restrita: invoices built without a template. Every issued one is cancelled.
const RESULTS = new URL('./results.local.json', import.meta.url);
let nextNumber = Math.floor(Date.now() / 1000) % 1_000_000_000;

function base(serviceCents: number): Omit<DpsInput, 'customer' | 'tax' | 'service'> {
  const issuedAt = new Date(Date.now() - 60_000);
  return {
    environment: 'producao_restrita',
    issuedAt,
    appVersion,
    series: env('NOTAFLOW_DPS_SERIES'),
    number: nextNumber++,
    competence: formatBrasiliaDate(issuedAt),
    emitterMunicipality: env('NOTAFLOW_EMITTER_MUNICIPALITY'),
    provider: {
      cnpj: certificate.cnpj,
      ...(process.env.NOTAFLOW_EMITTER_MUNICIPAL_REGISTRATION
        ? { municipalRegistration: process.env.NOTAFLOW_EMITTER_MUNICIPAL_REGISTRATION }
        : {}),
      simplesNacional: env('NOTAFLOW_SIMPLES_NACIONAL') as DpsInput['provider']['simplesNacional'],
      simplesRegime: env('NOTAFLOW_SIMPLES_REGIME') as NonNullable<
        DpsInput['provider']['simplesRegime']
      >,
      specialRegime: env('NOTAFLOW_SPECIAL_REGIME') as DpsInput['provider']['specialRegime'],
    },
    amounts: { serviceCents },
  };
}

function service(description: string): DpsInput['service'] {
  return {
    municipality: env('NOTAFLOW_EMITTER_MUNICIPALITY'),
    nationalTaxCode: env('NOTAFLOW_SERVICE_NATIONAL_CODE'),
    description,
    nbsCode: env('NOTAFLOW_SERVICE_NBS'),
  };
}

// A synthetic Brazil customer in the emitter's own municipality.
const domesticCustomer: DpsInput['customer'] = {
  document: { type: 'CNPJ', value: '11222333000181' },
  name: 'Cliente Teste Ltda',
  address: {
    municipality: env('NOTAFLOW_EMITTER_MUNICIPALITY'),
    zip: '86010000',
    street: 'Rua Teste',
    number: '1',
    district: 'Centro',
  },
};

const simplesTotalPercent = env('NOTAFLOW_SIMPLES_TOTAL_PERCENT');

// NT 009 (E0855): every DPS with a competence from 2026-10-01 has the IBSCBS group; 000001 is the regular rate.
const domesticIbsCbs: DpsInput['ibsCbs'] = {
  purpose: '0',
  finalConsumer: '0',
  operationCode: '100301',
  destination: '0',
  cst: '000',
  classCode: '000001',
};

// Issue #84: the group the app now writes, from the Anexo VIII defaults of the service and indFinal by document.
function defaultsGroup(finalConsumer: '0' | '1'): DpsInput['ibsCbs'] {
  return {
    purpose: '0',
    finalConsumer,
    destination: '0',
    ...ibsCbsDefaults(env('NOTAFLOW_SERVICE_NATIONAL_CODE')),
  };
}

const variants: Record<string, () => DpsInput> = {
  'nt009-defaults-cnpj': () => ({
    ...base(1000),
    customer: domesticCustomer,
    service: service('Teste NotaFlow #84: grupo IBSCBS padrao, tomador CNPJ'),
    ibsCbs: defaultsGroup('0'),
    tax: {
      issqnTaxation: '1',
      issRetention: '1',
      pisCofins: { cst: '00', retention: '0' },
      simplesTotalPercent,
    },
  }),
  'nt009-defaults-cpf': () => ({
    ...base(1000),
    customer: { ...domesticCustomer, document: { type: 'CPF', value: '52998224725' }, name: 'Pessoa Teste' },
    service: service('Teste NotaFlow #84: grupo IBSCBS padrao, tomador CPF'),
    ibsCbs: defaultsGroup('1'),
    tax: {
      issqnTaxation: '1',
      issRetention: '1',
      pisCofins: { cst: '00', retention: '0' },
      simplesTotalPercent,
    },
  }),
  'domestic-iss': () => ({
    ...base(1000),
    customer: domesticCustomer,
    service: service('Teste NotaFlow 2a: nota nacional com ISS'),
    tax: {
      issqnTaxation: '1',
      issRetention: '1',
      issRatePercent: '2.00',
      pisCofins: { cst: '00', retention: '0' },
      simplesTotalPercent,
    },
  }),
  'domestic-no-aliq': () => ({
    ...base(1000),
    customer: domesticCustomer,
    service: service('Teste NotaFlow 2a: nota nacional sem aliquota'),
    ibsCbs: domesticIbsCbs,
    tax: {
      issqnTaxation: '1',
      issRetention: '1',
      pisCofins: { cst: '00', retention: '0' },
      simplesTotalPercent,
    },
  }),
  'domestic-retained': () => ({
    ...base(1000),
    customer: domesticCustomer,
    service: service('Teste NotaFlow 2a: nota nacional com ISS retido'),
    tax: {
      issqnTaxation: '1',
      issRetention: '2',
      issRatePercent: '2.00',
      pisCofins: { cst: '00', retention: '0' },
      simplesTotalPercent,
    },
  }),
  // IN RFB 2110/2022 puts the 11% retention on Anexo IV only: does the Sefin accept vRetCP from any Simples ME/EPP?
  'domestic-inss': () => ({
    ...base(1000),
    customer: domesticCustomer,
    service: service('Teste NotaFlow: nota nacional com INSS retido'),
    ibsCbs: domesticIbsCbs,
    tax: {
      issqnTaxation: '1',
      issRetention: '1',
      pisCofins: { cst: '00', retention: '0' },
      cpRetainedCents: 110,
      simplesTotalPercent,
    },
  }),
  'export-built': () => {
    const country = env('NOTAFLOW_CUSTOMER_COUNTRY');
    return {
      ...base(518),
      customer: {
        document: { type: 'NIF', value: env('NOTAFLOW_CUSTOMER_NIF') },
        name: env('NOTAFLOW_CUSTOMER_NAME'),
        address: {
          country,
          postalCode: env('NOTAFLOW_CUSTOMER_POSTAL_CODE'),
          city: env('NOTAFLOW_CUSTOMER_CITY'),
          region: env('NOTAFLOW_CUSTOMER_REGION'),
          street: env('NOTAFLOW_CUSTOMER_STREET'),
          number: env('NOTAFLOW_CUSTOMER_NUMBER'),
          district: env('NOTAFLOW_CUSTOMER_DISTRICT'),
        },
      },
      service: {
        ...service('Teste NotaFlow 2a: exportacao montada sem modelo'),
        foreignTrade: {
          mode: '1',
          providerLink: '0',
          currency: '220',
          amountInCurrencyCents: 100,
          providerSupport: '02',
          customerSupport: '02',
          temporaryGoods: '1',
          mdic: '0',
        },
      },
      tax: {
        issqnTaxation: '3',
        resultCountry: country,
        issRetention: '1',
        pisCofins: { cst: '00', retention: '0' },
        simplesTotalPercent,
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
  },
};

const results: Record<string, unknown> = {};
const issued: string[] = [];
const only = process.argv[2];
for (const [name, build] of Object.entries(variants)) {
  if (only && name !== only) continue;
  if (name === 'domestic-no-aliq' && !only) {
    const first = results['domestic-iss'] as { kind?: string } | undefined;
    if (first?.kind === 'issued') continue; // only needed when the rate was refused
  }
  const signed = await nodeSigner.sign({
    xml: buildDpsXml(build()).xml,
    elementName: 'infDPS',
    certificate,
    profile: 'rsa-sha256-exc-c14n',
  });
  const result = await client.issue(signed);
  results[name] =
    result.kind === 'issued' ? { kind: 'issued', accessKey: result.accessKey } : result;
  if (result.kind === 'issued') issued.push(result.accessKey);
  console.log(name, result.kind, result.kind === 'rejected' ? JSON.stringify(result.errors) : '');
}

const cancellations: Record<string, string> = {};
for (const accessKey of issued) {
  const result = await cancelInvoice(accessKey);
  cancellations[accessKey] = result.kind === 'registered' ? 'cancelled' : JSON.stringify(result);
  console.log('cancel', accessKey.slice(-6), cancellations[accessKey]);
}
writeFileSync(RESULTS, JSON.stringify({ results, cancellations }, null, 2));
console.log(
  `Issued ${issued.length}, cancelled ${Object.values(cancellations).filter((c) => c === 'cancelled').length}.`,
);
