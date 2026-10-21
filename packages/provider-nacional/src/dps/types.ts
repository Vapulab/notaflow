import type { Environment } from '@notaflow/core';

export type { Environment };

export interface Address {
  municipality: string; // IBGE, 7 digits
  zip: string; // 8 digits
  street: string;
  number: string;
  complement?: string;
  district: string;
}

export interface ForeignAddress {
  country: string; // ISO 3166-1 alpha-2
  postalCode: string;
  city: string;
  region: string;
  street: string;
  number: string;
  complement?: string;
  district: string;
}

// Codes follow TCComExterior in tiposComplexos_v1.01.xsd.
export interface ForeignTrade {
  mode: '0' | '1' | '2' | '3' | '4'; // mdPrestacao
  providerLink: '0' | '1' | '2' | '3' | '4' | '5' | '6'; // vincPrest
  currency: string; // tpMoeda, BACEN code (220 = USD)
  amountInCurrencyCents: number;
  providerSupport: string; // mecAFComexP, 2 digits
  customerSupport: string; // mecAFComexT, 2 digits
  temporaryGoods: '0' | '1' | '2' | '3'; // movTempBens
  mdic: '0' | '1';
}

export interface DpsInput {
  environment: Environment;
  issuedAt: Date;
  appVersion: string;
  series: string;
  number: number;
  competence: string; // YYYY-MM-DD
  emitterMunicipality: string;
  provider: {
    cnpj: string;
    municipalRegistration?: string;
    phone?: string;
    email?: string;
    simplesNacional: '1' | '2' | '3';
    simplesRegime?: '1' | '2' | '3';
    specialRegime: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '9';
  };
  customer?: {
    document: { type: 'CNPJ' | 'CPF' | 'NIF'; value: string };
    municipalRegistration?: string;
    name: string;
    address?: Address | ForeignAddress;
    phone?: string;
    email?: string;
  };
  service: {
    municipality: string;
    nationalTaxCode: string; // cTribNac, 6 digits
    municipalTaxCode?: string; // cTribMun, 3 digits
    description: string;
    nbsCode?: string; // 9 digits
    foreignTrade?: ForeignTrade;
  };
  amounts: { serviceCents: number };
  tax: {
    issqnTaxation: '1' | '2' | '3' | '4';
    resultCountry?: string; // cPaisResult, for an export
    issRetention: '1' | '2' | '3';
    issRatePercent?: string; // e.g. "2.00"
    pisCofins?: { cst: string; retention?: string };
    cpRetainedCents?: number; // vRetCP, the INSS the customer retains
    // pTotTribSN; without it the DPS says indTotTrib 0.
    simplesTotalPercent?: string;
  };
  // Optional in the 1.01 XSD; codes follow TCRTCInfoIBSCBS.
  ibsCbs?: {
    purpose: string; // finNFSe
    finalConsumer?: '0' | '1'; // indFinal
    operationCode: string; // cIndOp, 6 digits
    destination: string; // indDest
    cst: string;
    classCode: string; // cClassTrib
  };
}
