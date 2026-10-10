import { writeFileSync } from 'node:fs';
import { formatBrasiliaDate, NacionalIssuer, parseNfseXml } from '@notaflow/provider-nacional';
import { certificate, client, env } from '../2026-10-sefin/session';

type NewInvoiceInput = Parameters<NacionalIssuer['buildTemplate']>[0];

// Pre-PR check in produção restrita through the code the server runs: buildTemplate, NacionalIssuer.issue, the
// DPS id lookup, a resend of the same DPS (E0014 recovery), and cancel. Every issued invoice is cancelled.
const RESULTS = new URL('./results.local.issuer.json', import.meta.url);
const issuer = new NacionalIssuer({
  client,
  certificate,
  environment: 'producao_restrita',
  appVersion: 'notaflow-2a-check',
});
const series = env('NOTAFLOW_DPS_SERIES');
let nextNumber = (Math.floor(Date.now() / 1000) % 1_000_000_000) + 500;
const competence = formatBrasiliaDate(new Date());
const municipality = env('NOTAFLOW_EMITTER_MUNICIPALITY');
const simplesPercent = Math.round(Number(env('NOTAFLOW_SIMPLES_TOTAL_PERCENT')) * 100);

const emitter: NewInvoiceInput['emitter'] = {
  cnpj: certificate.cnpj,
  municipality,
  ...(process.env.NOTAFLOW_EMITTER_MUNICIPAL_REGISTRATION
    ? { municipalRegistration: process.env.NOTAFLOW_EMITTER_MUNICIPAL_REGISTRATION }
    : {}),
  simplesNacional: env(
    'NOTAFLOW_SIMPLES_NACIONAL',
  ) as NewInvoiceInput['emitter']['simplesNacional'],
  simplesRegime: env('NOTAFLOW_SIMPLES_REGIME') as NonNullable<
    NewInvoiceInput['emitter']['simplesRegime']
  >,
  specialRegime: env('NOTAFLOW_SPECIAL_REGIME') as NewInvoiceInput['emitter']['specialRegime'],
};
const service = (description: string, extra: Partial<NewInvoiceInput['service']> = {}) => ({
  nationalTaxCode: env('NOTAFLOW_SERVICE_NATIONAL_CODE'),
  nbsCode: env('NOTAFLOW_SERVICE_NBS'),
  description,
  pisCofinsCst: '00',
  ...extra,
});
const domesticAddress = {
  kind: 'domestic' as const,
  municipality,
  zip: '86010000',
  street: 'Rua Teste',
  number: '1',
  district: 'Centro',
};

const variants: Record<string, NewInvoiceInput> = {
  'cnpj-domestic': {
    competence,
    emitter,
    service: service('Teste NotaFlow 2a: CNPJ nacional'),
    customer: {
      document: { type: 'CNPJ', value: '11222333000181' },
      name: 'Cliente Teste Ltda',
      address: domesticAddress,
    },
    serviceCents: 1234,
    simplesPercent,
    issRate: 200,
  },
  'cpf-domestic': {
    competence,
    emitter,
    service: service('Teste NotaFlow 2a: CPF nacional'),
    customer: {
      document: { type: 'CPF', value: '11144477735' },
      name: 'Pessoa Teste',
      address: domesticAddress,
    },
    serviceCents: 999,
    simplesPercent,
  },
  'cnpj-retained': {
    competence,
    emitter,
    service: service('Teste NotaFlow 2a: ISS retido'),
    customer: {
      document: { type: 'CNPJ', value: '11222333000181' },
      name: 'Cliente Teste Ltda',
      address: domesticAddress,
    },
    serviceCents: 1001,
    simplesPercent,
    issRate: 200,
    issRetained: true,
  },
  export: {
    competence,
    emitter,
    service: service('Teste NotaFlow 2a: exportacao', {
      ibsCbs: { operationCode: '100302', cst: '410', classCode: '410027' },
    }),
    customer: {
      document: { type: 'NIF', value: env('NOTAFLOW_CUSTOMER_NIF') },
      name: env('NOTAFLOW_CUSTOMER_NAME'),
      address: {
        kind: 'foreign',
        country: env('NOTAFLOW_CUSTOMER_COUNTRY'),
        postalCode: env('NOTAFLOW_CUSTOMER_POSTAL_CODE'),
        city: env('NOTAFLOW_CUSTOMER_CITY'),
        region: env('NOTAFLOW_CUSTOMER_REGION'),
        street: env('NOTAFLOW_CUSTOMER_STREET'),
        number: env('NOTAFLOW_CUSTOMER_NUMBER'),
        district: env('NOTAFLOW_CUSTOMER_DISTRICT'),
      },
    },
    serviceCents: 518,
    foreign: { currencyCode: '220', amountCents: 100 },
    simplesPercent,
  },
};

const results: Record<string, unknown> = {};
const issued: string[] = [];
for (const [name, input] of Object.entries(variants)) {
  const source = { kind: 'built' as const, template: issuer.buildTemplate(input) };
  const number = nextNumber++;
  const request = {
    source,
    series,
    number,
    issuedAt: new Date(Date.now() - 60_000),
    competence,
    serviceCents: input.serviceCents,
    ...(input.foreign ? { foreignAmountCents: input.foreign.amountCents } : {}),
  };
  const outcome = await issuer.issue(request);
  if (outcome.kind !== 'issued') {
    results[name] = outcome;
    console.log(name, outcome.kind, JSON.stringify(outcome));
    continue;
  }
  const { invoice } = outcome;
  issued.push(invoice.accessKey);
  const parsed = parseNfseXml(invoice.xml);
  const checks = {
    amount: parsed.amounts.serviceCents === input.serviceCents,
    description: parsed.service.description === input.service.description,
    customer: parsed.customer?.document?.value === input.customer.document?.value,
    competence: parsed.competence === competence,
    simples: invoice.xml.includes(`<pTotTribSN>${(simplesPercent / 100).toFixed(2)}</pTotTribSN>`),
    retained: invoice.xml.includes(`<tpRetISSQN>${input.issRetained ? '2' : '1'}</tpRetISSQN>`),
    foreign: input.foreign ? invoice.xml.includes('<vServMoeda>1.00</vServMoeda>') : true,
  };
  // The DPS id the server stores must find this invoice.
  const found = await issuer.findIssued(issuer.dpsId(series, number, source));
  // A resend of the same DPS is what reconcile does; it must come back as the same invoice.
  const resend = await issuer.issue({ ...request, issuedAt: new Date(Date.now() - 60_000) });
  results[name] = {
    accessKey: invoice.accessKey,
    checks,
    foundByDpsId: found?.accessKey === invoice.accessKey,
    resend:
      resend.kind === 'issued'
        ? {
            recovered: resend.recovered === true,
            same: resend.invoice.accessKey === invoice.accessKey,
          }
        : resend,
  };
  console.log(name, 'issued', JSON.stringify(results[name]));
}

const cancellations: Record<string, string> = {};
for (const accessKey of issued) {
  const result = await issuer.cancel(accessKey, '1', 'Teste de cancelamento NotaFlow 2a');
  cancellations[accessKey] = result.kind === 'cancelled' ? 'cancelled' : JSON.stringify(result);
  console.log('cancel', accessKey.slice(-6), cancellations[accessKey]);
}
writeFileSync(RESULTS, JSON.stringify({ results, cancellations }, null, 2));
console.log(
  `Issued ${issued.length}, cancelled ${Object.values(cancellations).filter((c) => c === 'cancelled').length}.`,
);
