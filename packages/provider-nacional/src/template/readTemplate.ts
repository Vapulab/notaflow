import type { Element } from '@xmldom/xmldom';
import type { Address, DpsInput, ForeignAddress, ForeignTrade } from '../dps/types';
import { decimalToCents } from '../xml/formatters';
import { child, childElements, parseXmlRoot, requiredChild, requiredText, text } from '../xml/readXml';

export type DpsTemplate = Omit<
  DpsInput,
  'environment' | 'issuedAt' | 'appVersion' | 'series' | 'number' | 'competence' | 'amounts'
> & { serviceCents: number };

type Provider = DpsInput['provider'];
type Customer = NonNullable<DpsInput['customer']>;
type Tax = DpsInput['tax'];

export class TemplateUnsupportedError extends Error {
  constructor(readonly paths: string[]) {
    super(`The template has fields NotaFlow cannot copy yet: ${paths.join(', ')}`);
    this.name = 'TemplateUnsupportedError';
  }
}

// Exactly what buildDpsXml writes, so reading and building are inverse operations.
const SUPPORTED = new Set(
  `tpAmb dhEmi verAplic serie nDPS dCompet tpEmit cLocEmi
  prest/CNPJ prest/IM prest/fone prest/email prest/regTrib/opSimpNac prest/regTrib/regApTribSN prest/regTrib/regEspTrib
  toma/CNPJ toma/CPF toma/NIF toma/IM toma/xNome toma/fone toma/email
  toma/end/endNac/cMun toma/end/endNac/CEP
  toma/end/endExt/cPais toma/end/endExt/cEndPost toma/end/endExt/xCidade toma/end/endExt/xEstProvReg
  toma/end/xLgr toma/end/nro toma/end/xCpl toma/end/xBairro
  serv/locPrest/cLocPrestacao serv/cServ/cTribNac serv/cServ/cTribMun serv/cServ/xDescServ serv/cServ/cNBS
  serv/comExt/mdPrestacao serv/comExt/vincPrest serv/comExt/tpMoeda serv/comExt/vServMoeda
  serv/comExt/mecAFComexP serv/comExt/mecAFComexT serv/comExt/movTempBens serv/comExt/mdic
  valores/vServPrest/vServ
  valores/trib/tribMun/tribISSQN valores/trib/tribMun/cPaisResult valores/trib/tribMun/tpRetISSQN valores/trib/tribMun/pAliq
  valores/trib/tribFed/piscofins/CST valores/trib/tribFed/piscofins/tpRetPisCofins valores/trib/tribFed/vRetCP
  valores/trib/totTrib/pTotTribSN valores/trib/totTrib/indTotTrib
  IBSCBS/finNFSe IBSCBS/indFinal IBSCBS/cIndOp IBSCBS/indDest
  IBSCBS/valores/trib/gIBSCBS/CST IBSCBS/valores/trib/gIBSCBS/cClassTrib`.split(/\s+/),
);

function leafPaths(element: Element, prefix: string): string[] {
  const children = childElements(element);
  if (children.length === 0) return [prefix];
  return children.flatMap((c) => leafPaths(c, prefix ? `${prefix}/${c.localName}` : String(c.localName)));
}

export function readTemplate(nfseXml: string): DpsTemplate {
  const dps = requiredChild(parseXmlRoot(nfseXml, 'NFSe'), 'infNFSe', 'DPS', 'infDPS');
  const unsupported = leafPaths(dps, '').filter((path) => !SUPPORTED.has(path));
  if (unsupported.length > 0) throw new TemplateUnsupportedError(unsupported);

  const serv = requiredChild(dps, 'serv');
  const toma = child(dps, 'toma');
  const comExt = child(serv, 'comExt');
  const ibs = child(dps, 'IBSCBS');
  const municipalTaxCode = text(serv, 'cServ', 'cTribMun');
  const nbsCode = text(serv, 'cServ', 'cNBS');
  return {
    emitterMunicipality: requiredText(dps, 'cLocEmi'),
    provider: providerOf(requiredChild(dps, 'prest')),
    ...(toma ? { customer: customerOf(toma) } : {}),
    service: {
      municipality: requiredText(serv, 'locPrest', 'cLocPrestacao'),
      nationalTaxCode: requiredText(serv, 'cServ', 'cTribNac'),
      ...(municipalTaxCode ? { municipalTaxCode } : {}),
      description: requiredText(serv, 'cServ', 'xDescServ'),
      ...(nbsCode ? { nbsCode } : {}),
      ...(comExt ? { foreignTrade: foreignTradeOf(comExt) } : {}),
    },
    serviceCents: decimalToCents(requiredText(dps, 'valores', 'vServPrest', 'vServ')),
    tax: taxOf(requiredChild(dps, 'valores', 'trib')),
    ...(ibs ? { ibsCbs: ibsCbsOf(ibs) } : {}),
  };
}

function providerOf(prest: Element): Provider {
  const municipalRegistration = text(prest, 'IM');
  const phone = text(prest, 'fone');
  const email = text(prest, 'email');
  const simplesRegime = text(prest, 'regTrib', 'regApTribSN') as Provider['simplesRegime'];
  return {
    cnpj: requiredText(prest, 'CNPJ'),
    ...(municipalRegistration ? { municipalRegistration } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    simplesNacional: requiredText(prest, 'regTrib', 'opSimpNac') as Provider['simplesNacional'],
    ...(simplesRegime ? { simplesRegime } : {}),
    specialRegime: requiredText(prest, 'regTrib', 'regEspTrib') as Provider['specialRegime'],
  };
}

function customerOf(toma: Element): Customer {
  const document = (['CNPJ', 'CPF', 'NIF'] as const)
    .map((type) => ({ type, value: text(toma, type) ?? '' }))
    .find((d) => d.value !== '');
  // The builder cannot write cNaoNIF, so a customer without a document cannot be copied.
  if (!document) throw new TemplateUnsupportedError(['toma/cNaoNIF']);
  const municipalRegistration = text(toma, 'IM');
  const end = child(toma, 'end');
  const phone = text(toma, 'fone');
  const email = text(toma, 'email');
  return {
    document,
    ...(municipalRegistration ? { municipalRegistration } : {}),
    name: requiredText(toma, 'xNome'),
    ...(end ? { address: addressOf(end) } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
  };
}

function addressOf(end: Element): Address | ForeignAddress {
  const complement = text(end, 'xCpl');
  const common = {
    street: requiredText(end, 'xLgr'),
    number: requiredText(end, 'nro'),
    ...(complement ? { complement } : {}),
    district: requiredText(end, 'xBairro'),
  };
  if (child(end, 'endExt')) {
    return {
      country: requiredText(end, 'endExt', 'cPais'),
      postalCode: requiredText(end, 'endExt', 'cEndPost'),
      city: requiredText(end, 'endExt', 'xCidade'),
      region: requiredText(end, 'endExt', 'xEstProvReg'),
      ...common,
    };
  }
  return {
    municipality: requiredText(end, 'endNac', 'cMun'),
    zip: requiredText(end, 'endNac', 'CEP'),
    ...common,
  };
}

function foreignTradeOf(comExt: Element): ForeignTrade {
  return {
    mode: requiredText(comExt, 'mdPrestacao') as ForeignTrade['mode'],
    providerLink: requiredText(comExt, 'vincPrest') as ForeignTrade['providerLink'],
    currency: requiredText(comExt, 'tpMoeda'),
    amountInCurrencyCents: decimalToCents(requiredText(comExt, 'vServMoeda')),
    providerSupport: requiredText(comExt, 'mecAFComexP'),
    customerSupport: requiredText(comExt, 'mecAFComexT'),
    temporaryGoods: requiredText(comExt, 'movTempBens') as ForeignTrade['temporaryGoods'],
    mdic: requiredText(comExt, 'mdic') as ForeignTrade['mdic'],
  };
}

function taxOf(trib: Element): Tax {
  const resultCountry = text(trib, 'tribMun', 'cPaisResult');
  const issRatePercent = text(trib, 'tribMun', 'pAliq');
  const tribFed = child(trib, 'tribFed');
  const pisCofins = tribFed && child(tribFed, 'piscofins') ? tribFed : undefined;
  const retention = pisCofins ? text(pisCofins, 'piscofins', 'tpRetPisCofins') : undefined;
  const cpRetained = text(trib, 'tribFed', 'vRetCP');
  const simplesTotalPercent = text(trib, 'totTrib', 'pTotTribSN');
  return {
    issqnTaxation: requiredText(trib, 'tribMun', 'tribISSQN') as Tax['issqnTaxation'],
    ...(resultCountry ? { resultCountry } : {}),
    issRetention: requiredText(trib, 'tribMun', 'tpRetISSQN') as Tax['issRetention'],
    ...(issRatePercent ? { issRatePercent } : {}),
    ...(pisCofins
      ? {
          pisCofins: {
            cst: requiredText(pisCofins, 'piscofins', 'CST'),
            ...(retention ? { retention } : {}),
          },
        }
      : {}),
    ...(cpRetained ? { cpRetainedCents: decimalToCents(cpRetained) } : {}),
    ...(simplesTotalPercent ? { simplesTotalPercent } : {}),
  };
}

function ibsCbsOf(ibs: Element): NonNullable<DpsInput['ibsCbs']> {
  const finalConsumer = text(ibs, 'indFinal') as '0' | '1' | undefined;
  return {
    purpose: requiredText(ibs, 'finNFSe'),
    ...(finalConsumer ? { finalConsumer } : {}),
    operationCode: requiredText(ibs, 'cIndOp'),
    destination: requiredText(ibs, 'indDest'),
    cst: requiredText(ibs, 'valores', 'trib', 'gIBSCBS', 'CST'),
    classCode: requiredText(ibs, 'valores', 'trib', 'gIBSCBS', 'cClassTrib'),
  };
}
