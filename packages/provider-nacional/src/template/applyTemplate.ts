import { percentText } from '../rules/simplesBands';
import type { InvoiceParty, IssueRequest, PartyAddress } from '@notaflow/core';
import type { Address, DpsInput, Environment, ForeignAddress } from '../dps/types';
import type { DpsTemplate } from './readTemplate';

export function applyTemplate(
  template: DpsTemplate,
  request: IssueRequest & { environment: Environment; appVersion: string },
): DpsInput {
  const { serviceCents: _templateAmount, ...copy } = template;
  // The Sefin accepts a zero amount (Stage 0 Results), so the app refuses it.
  if (request.serviceCents <= 0) throw new RangeError('The service amount must be above zero.');
  const foreignTrade = copy.service.foreignTrade;
  if (foreignTrade && !request.foreignAmountCents) {
    throw new RangeError('An export invoice needs the amount in the foreign currency.');
  }
  return {
    ...copy,
    environment: request.environment,
    issuedAt: request.issuedAt,
    appVersion: request.appVersion,
    series: request.series,
    number: request.number,
    competence: request.competence,
    ...(request.customer ? { customer: toDpsCustomer(request.customer) } : {}),
    service: {
      ...copy.service,
      ...(request.description ? { description: request.description } : {}),
      ...(foreignTrade && request.foreignAmountCents
        ? { foreignTrade: { ...foreignTrade, amountInCurrencyCents: request.foreignAmountCents } }
        : {}),
    },
    amounts: { serviceCents: request.serviceCents },
    ...(request.simplesPercent !== undefined
      ? { tax: { ...copy.tax, simplesTotalPercent: percentText(request.simplesPercent) } }
      : {}),
  };
}

export function toDpsCustomer(party: InvoiceParty): NonNullable<DpsInput['customer']> {
  if (!party.document) throw new RangeError('The customer needs a CNPJ, CPF, or NIF.');
  return {
    document: party.document,
    name: party.name,
    ...(party.municipalRegistration ? { municipalRegistration: party.municipalRegistration } : {}),
    ...(party.address ? { address: toDpsAddress(party.address) } : {}),
    ...(party.phone ? { phone: party.phone } : {}),
    ...(party.email ? { email: party.email } : {}),
  };
}

function toDpsAddress(address: PartyAddress): Address | ForeignAddress {
  if (address.kind === 'foreign') {
    const { kind: _kind, ...foreign } = address;
    return foreign;
  }
  const { kind: _kind, ...domestic } = address;
  return domestic;
}
