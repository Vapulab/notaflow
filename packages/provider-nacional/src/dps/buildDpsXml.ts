import { escapeXml } from '../xml/escapeXml';
import { centsToDecimal, formatBrasiliaDateTime } from '../xml/formatters';
import { buildDpsId } from './buildDpsId';
import type { Address, DpsInput, ForeignAddress, ForeignTrade } from './types';

export const NFSE_NAMESPACE = 'http://www.sped.fazenda.gov.br/nfse';
export const SCHEMA_VERSION = '1.01';

// Element order follows tiposComplexos_v1.01.xsd; the XSD test fails on any reorder.
export function buildDpsXml(input: DpsInput): { id: string; xml: string } {
  const id = buildDpsId({
    municipality: input.emitterMunicipality,
    cnpj: input.provider.cnpj,
    series: input.series,
    number: input.number,
  });

  const xml =
    `<DPS xmlns="${NFSE_NAMESPACE}" versao="${SCHEMA_VERSION}">` +
    `<infDPS Id="${id}">` +
    tag('tpAmb', input.environment === 'producao' ? '1' : '2') +
    tag('dhEmi', formatBrasiliaDateTime(input.issuedAt)) +
    tag('verAplic', input.appVersion) +
    tag('serie', input.series) +
    tag('nDPS', String(input.number)) +
    tag('dCompet', input.competence) +
    tag('tpEmit', '1') +
    tag('cLocEmi', input.emitterMunicipality) +
    provider(input) +
    customer(input) +
    service(input) +
    amounts(input) +
    ibsCbs(input) +
    `</infDPS></DPS>`;

  return { id, xml };
}

function tag(name: string, value: string | undefined): string {
  return value === undefined ? '' : `<${name}>${escapeXml(value)}</${name}>`;
}

function provider({ provider: p }: DpsInput): string {
  return (
    '<prest>' +
    tag('CNPJ', p.cnpj) +
    tag('IM', p.municipalRegistration) +
    tag('fone', p.phone) +
    tag('email', p.email) +
    '<regTrib>' +
    tag('opSimpNac', p.simplesNacional) +
    tag('regApTribSN', p.simplesRegime) +
    tag('regEspTrib', p.specialRegime) +
    '</regTrib></prest>'
  );
}

function customer({ customer: c }: DpsInput): string {
  if (!c) return '';
  return (
    '<toma>' +
    tag(c.document.type, c.document.value) +
    tag('IM', c.municipalRegistration) +
    tag('xNome', c.name) +
    (c.address ? address(c.address) : '') +
    tag('fone', c.phone) +
    tag('email', c.email) +
    '</toma>'
  );
}

function address(a: Address | ForeignAddress): string {
  const place =
    'country' in a
      ? '<endExt>' +
        tag('cPais', a.country) +
        tag('cEndPost', a.postalCode) +
        tag('xCidade', a.city) +
        tag('xEstProvReg', a.region) +
        '</endExt>'
      : '<endNac>' + tag('cMun', a.municipality) + tag('CEP', a.zip) + '</endNac>';
  return (
    '<end>' +
    place +
    tag('xLgr', a.street) +
    tag('nro', a.number) +
    tag('xCpl', a.complement) +
    tag('xBairro', a.district) +
    '</end>'
  );
}

function service({ service: s }: DpsInput): string {
  return (
    '<serv><locPrest>' +
    tag('cLocPrestacao', s.municipality) +
    '</locPrest><cServ>' +
    tag('cTribNac', s.nationalTaxCode) +
    tag('cTribMun', s.municipalTaxCode) +
    tag('xDescServ', s.description) +
    tag('cNBS', s.nbsCode) +
    '</cServ>' +
    (s.foreignTrade ? foreignTrade(s.foreignTrade) : '') +
    '</serv>'
  );
}

function foreignTrade(f: ForeignTrade): string {
  return (
    '<comExt>' +
    tag('mdPrestacao', f.mode) +
    tag('vincPrest', f.providerLink) +
    tag('tpMoeda', f.currency) +
    tag('vServMoeda', centsToDecimal(f.amountInCurrencyCents)) +
    tag('mecAFComexP', f.providerSupport) +
    tag('mecAFComexT', f.customerSupport) +
    tag('movTempBens', f.temporaryGoods) +
    tag('mdic', f.mdic) +
    '</comExt>'
  );
}

function amounts({ amounts: a, tax: t }: DpsInput): string {
  return (
    '<valores><vServPrest>' +
    tag('vServ', centsToDecimal(a.serviceCents)) +
    '</vServPrest><trib><tribMun>' +
    tag('tribISSQN', t.issqnTaxation) +
    tag('cPaisResult', t.resultCountry) +
    tag('tpRetISSQN', t.issRetention) +
    tag('pAliq', t.issRatePercent) +
    '</tribMun>' +
    (t.pisCofins || t.cpRetainedCents !== undefined
      ? '<tribFed>' +
        (t.pisCofins
          ? '<piscofins>' +
            tag('CST', t.pisCofins.cst) +
            tag('tpRetPisCofins', t.pisCofins.retention) +
            '</piscofins>'
          : '') +
        tag(
          'vRetCP',
          t.cpRetainedCents === undefined ? undefined : centsToDecimal(t.cpRetainedCents),
        ) +
        '</tribFed>'
      : '') +
    '<totTrib>' +
    (t.simplesTotalPercent === undefined
      ? tag('indTotTrib', '0')
      : tag('pTotTribSN', t.simplesTotalPercent)) +
    '</totTrib></trib></valores>'
  );
}

function ibsCbs({ ibsCbs: g }: DpsInput): string {
  if (!g) return '';
  return (
    '<IBSCBS>' +
    tag('finNFSe', g.purpose) +
    tag('indFinal', g.finalConsumer) +
    tag('cIndOp', g.operationCode) +
    tag('indDest', g.destination) +
    '<valores><trib><gIBSCBS>' +
    tag('CST', g.cst) +
    tag('cClassTrib', g.classCode) +
    '</gIBSCBS></trib></valores></IBSCBS>'
  );
}
