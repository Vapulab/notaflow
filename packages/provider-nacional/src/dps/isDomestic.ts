import type { DpsInput } from './types';

type DomesticProbe = {
  service: Pick<DpsInput['service'], 'foreignTrade'>;
  customer?: Pick<NonNullable<DpsInput['customer']>, 'document'> | undefined;
  tax: Pick<DpsInput['tax'], 'issqnTaxation'>;
};

// Only a domestic invoice carries the default IBS/CBS group; any export sign (comExt, NIF, tribISSQN 3) rules it out.
export function isDomestic({ service, customer, tax }: DomesticProbe): boolean {
  if (service.foreignTrade || tax.issqnTaxation === '3') return false;
  return !customer || customer.document.type === 'CNPJ' || customer.document.type === 'CPF';
}
