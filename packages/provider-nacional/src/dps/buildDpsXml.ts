import { escapeXml } from '../xml/escapeXml';
import { centsToDecimal, formatBrasiliaDateTime } from '../xml/formatters';
import { buildDpsId } from './buildDpsId';
import { type DpsLayout, dpsLayout } from './layout';
import type { Address, DpsInput, ForeignAddress, ForeignTrade } from './types';

export const NFSE_NAMESPACE = 'http://www.sped.fazenda.gov.br/nfse';
export const SCHEMA_VERSION = '1.01';
const UNTAXED_CST = new Set(['400', '410', '820']);

// Element order follows tiposComplexos_v1.01.xsd of each layout; the XSD tests fail on any reorder.
export function buildDpsXml(input: DpsInput): { id: string; xml: string } {
  const id = buildDpsId({
    municipality: input.emitterMunicipality,
    cnpj: input.provider.cnpj,
    series: input.series,
    number: input.number,
  });
  const layout = dpsLayout(input.environment, input.issuedAt);

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
    // NT 009 moves finNFSe out of IBSCBS and makes it required; 0 is a regular NFS-e.
    (layout === 'nt009' ? tag('finNFSe', input.ibsCbs?.purpose ?? '0') : '') +
    tag('cLocEmi', input.emitterMunicipality) +
    provider(input) +
    customer(input) +
    service(input, layout) +
    amounts(input) +
    ibsCbs(input, layout) +
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

function service({ service: s }: DpsInput, layout: DpsLayout): string {
  const description = tag('xDescServ', s.description);
  return (
    '<serv><locPrest>' +
    tag('cLocPrestacao', s.municipality) +
    '</locPrest><cServ>' +
    tag('cTribNac', s.nationalTaxCode) +
    tag('cTribMun', s.municipalTaxCode) +
    (layout === 'nt004' ? description : '') +
    tag('cNBS', s.nbsCode) +
    (layout === 'nt009' ? description : '') +
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

function ibsCbs({ ibsCbs: g }: DpsInput, layout: DpsLayout): string {
  if (!g) return '';
  const classification = tag('CST', g.cst) + tag('cClassTrib', g.classCode);
  // NT 009, 2.16: CST 400, 410, and 820 have no IBS/CBS due, so no cIndOp (E0859) and no gIBSCBS (E0961).
  const due = !UNTAXED_CST.has(g.cst);
  return (
    '<IBSCBS>' +
    (layout === 'nt004' ? tag('finNFSe', g.purpose) : '') +
    tag('indFinal', g.finalConsumer) +
    (layout === 'nt004' || due ? tag('cIndOp', g.operationCode) : '') +
    tag('indDest', g.destination) +
    (layout === 'nt004'
      ? `<valores><trib><gIBSCBS>${classification}</gIBSCBS></trib></valores>`
      : `<valores><trib>${classification}${due ? '<gIBSCBS/>' : ''}</trib></valores>`) +
    '</IBSCBS>'
  );
}
