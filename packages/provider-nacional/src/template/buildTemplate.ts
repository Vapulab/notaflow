import type { NewInvoiceInput } from '@notaflow/core';
import type { ForeignTrade } from '../dps/types';
import { percentText } from '../rules/simplesBands';
import { minimumIssRate, taxRules } from '../rules/taxRules';
import { toDpsCustomer } from './applyTemplate';
import type { DpsTemplate } from './readTemplate';

// A service saved without export details: cross-border, no link, no support mechanism (01, Nenhum).
const EXPORT_DEFAULTS: NonNullable<NewInvoiceInput['service']['export']> = {
  mode: '1',
  providerLink: '0',
  providerSupport: '01',
  customerSupport: '01',
  temporaryGoods: '1',
  mdic: '0',
};

export function buildTemplate(input: NewInvoiceInput): DpsTemplate {
  const { emitter, service, customer } = input;
  if (input.serviceCents <= 0) throw new RangeError('The service amount must be above zero.');
  // The document alone picks the rules; the address must agree with it.
  const abroad = customer.document?.type !== 'CNPJ' && customer.document?.type !== 'CPF';
  const rules = taxRules(input.competence).forCustomer(abroad);
  const address = customer.address;
  if (abroad && (address?.kind !== 'foreign' || address.country === 'BR')) {
    throw new RangeError('A customer abroad needs a foreign address.');
  }
  if (!abroad && address?.kind !== 'domestic') {
    throw new RangeError('A Brazil customer needs a Brazilian address.');
  }

  const retained = !abroad && input.issRetained === true;
  if (retained && input.issRate === undefined) {
    throw new RangeError('A retained ISS needs the ISS rate.');
  }
  if (
    retained &&
    input.issRate !== undefined &&
    input.issRate < minimumIssRate(service.nationalTaxCode)
  ) {
    throw new RangeError('The ISS rate is below the legal minimum for this service.');
  }
  // The Sefin refuses pAliq from a Simples ME/EPP unless the ISS is retained (E0625).
  const issRatePercent =
    retained && rules.usesIssRate && input.issRate !== undefined
      ? percentText(input.issRate)
      : undefined;

  return {
    emitterMunicipality: emitter.municipality,
    provider: {
      cnpj: emitter.cnpj,
      ...(emitter.municipalRegistration
        ? { municipalRegistration: emitter.municipalRegistration }
        : {}),
      ...(emitter.phone ? { phone: emitter.phone } : {}),
      ...(emitter.email ? { email: emitter.email } : {}),
      simplesNacional: emitter.simplesNacional,
      ...(emitter.simplesRegime ? { simplesRegime: emitter.simplesRegime } : {}),
      specialRegime: emitter.specialRegime,
    },
    customer: toDpsCustomer(customer),
    service: {
      municipality: emitter.municipality,
      nationalTaxCode: service.nationalTaxCode,
      ...(service.municipalTaxCode ? { municipalTaxCode: service.municipalTaxCode } : {}),
      description: service.description,
      ...(service.nbsCode ? { nbsCode: service.nbsCode } : {}),
      ...(rules.foreignTrade ? { foreignTrade: foreignTradeOf(input) } : {}),
    },
    serviceCents: input.serviceCents,
    tax: {
      issqnTaxation: rules.issqnTaxation,
      ...(address?.kind === 'foreign' ? { resultCountry: address.country } : {}),
      issRetention: retained ? '2' : '1',
      ...(issRatePercent ? { issRatePercent } : {}),
      // PIS and COFINS do not apply to an export of services (08), whatever the service says.
      pisCofins: { cst: abroad ? '08' : (service.pisCofinsCst ?? '00'), retention: '0' },
      simplesTotalPercent: percentText(input.simplesPercent),
    },
    // 2026: the group is optional for the Simples; a service's codes describe its export.
    ...(abroad && service.ibsCbs
      ? {
          ibsCbs: {
            purpose: '0',
            finalConsumer: customer.document?.type === 'CPF' ? '1' : '0',
            operationCode: service.ibsCbs.operationCode,
            destination: '0',
            cst: service.ibsCbs.cst,
            classCode: service.ibsCbs.classCode,
          },
        }
      : {}),
  };
}

function foreignTradeOf(input: NewInvoiceInput): ForeignTrade {
  if (!input.foreign || input.foreign.amountCents <= 0) {
    throw new RangeError('An export invoice needs the amount in the foreign currency.');
  }
  return {
    ...(input.service.export ?? EXPORT_DEFAULTS),
    currency: input.foreign.currencyCode,
    amountInCurrencyCents: input.foreign.amountCents,
  };
}
