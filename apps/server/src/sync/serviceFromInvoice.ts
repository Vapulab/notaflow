import type { ProviderInvoice } from '@notaflow/core';
import {
  NfseParseError,
  readTemplate,
  TemplateUnsupportedError,
} from '@notaflow/provider-nacional';
import type { ServiceInput } from '../repos/ServiceRepository';

export function serviceFromInvoice(invoice: ProviderInvoice): {
  input: ServiceInput;
  importKey: string;
} {
  const { nationalTaxCode, description, nbsCode } = invoice.service;
  return {
    input: {
      name: description.slice(0, 100),
      nationalTaxCode,
      description,
      ...(nbsCode ? { nbsCode } : {}),
      ...fiscalGroupsOf(invoice.xml),
    },
    importKey: `${nationalTaxCode}|${description}`,
  };
}

// An invoice NotaFlow cannot read as a template still gives the code and description.
function fiscalGroupsOf(xml: string): Partial<ServiceInput> {
  let template;
  try {
    template = readTemplate(xml);
  } catch (error) {
    if (error instanceof TemplateUnsupportedError || error instanceof NfseParseError) return {};
    throw error;
  }
  const { municipalTaxCode, nbsCode, foreignTrade } = template.service;
  const cst = template.tax.pisCofins?.cst;
  const ibsCbs = template.ibsCbs;
  return {
    ...(municipalTaxCode ? { municipalTaxCode } : {}),
    ...(nbsCode ? { nbsCode } : {}),
    ...(cst ? { pisCofinsCst: cst } : {}),
    ...(ibsCbs
      ? {
          ibsCbs: {
            operationCode: ibsCbs.operationCode,
            cst: ibsCbs.cst,
            classCode: ibsCbs.classCode,
          },
        }
      : {}),
    ...(foreignTrade
      ? {
          export: {
            mode: foreignTrade.mode,
            providerLink: foreignTrade.providerLink,
            // The source invoices declared 02 (ACC, public administration); a service declares none.
            providerSupport: '01',
            customerSupport: '01',
            temporaryGoods: foreignTrade.temporaryGoods,
            mdic: foreignTrade.mdic,
          },
        }
      : {}),
  };
}
