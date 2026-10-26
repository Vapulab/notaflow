import { child, childElements, decimalToCents, formatBrasiliaDateTime, parseXmlRoot, requiredChild, NfseParseError } from '@notaflow/provider-nacional';
import * as codes from './codes';
import { FIELDS, type FieldKey } from './layout';

export interface DanfseData {
  fields: Record<FieldKey, string>;
  accessKey: string;
  testEnvironment: boolean;
  customer: 'present' | 'absent';
  recipient: 'present' | 'same' | 'absent';
  intermediary: 'present' | 'absent';
  issqn: 'present' | 'notSubject';
}

type El = NonNullable<ReturnType<typeof child>>;
type Drawn = 'logo' | 'documentTitle' | 'qrCode' | 'qrCaption';
type Values = Record<Exclude<FieldKey, Drawn>, string | undefined>;

const DASH = '-';
const TAXES_LINE = 'Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012';
// The NT sizes count the code (1 digit, 9 NBS digits), but the page prints a description or a masked value.
const UNCUT: ReadonlySet<FieldKey> = new Set(['generatorEnvironment', 'environmentType', 'serviceNbs', 'complementaryInfo']);

function at(el: El | undefined, ...names: string[]): El | undefined {
  let current = el;
  for (const name of names) current = current ? child(current, name) : undefined;
  return current;
}

function kids(el: El | undefined, name: string): El[] {
  return el ? childElements(el).filter((e) => e.localName === name) : [];
}

function val(el: El | undefined, ...names: string[]): string | undefined {
  const value = at(el, ...names)?.textContent?.trim();
  return value ? value : undefined;
}

function cut(value: string, max: number): string {
  const chars = [...value];
  return chars.length > max ? `${chars.slice(0, max - 3).join('')}...` : value;
}

function join(parts: readonly (string | undefined)[], separator: string): string | undefined {
  const present = parts.filter((p): p is string => p !== undefined);
  return present.length > 0 ? present.join(separator) : undefined;
}

function describe(map: Record<string, string>, code: string | undefined): string | undefined {
  return code === undefined ? undefined : (map[code] ?? code);
}

function toCents(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  try {
    return decimalToCents(value);
  } catch {
    return undefined;
  }
}

function formatCents(cents: number): string {
  const units = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+$)/g, '.');
  return `R$ ${units},${String(cents % 100).padStart(2, '0')}`;
}

function money(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const cents = toCents(value);
  return cents === undefined ? value : formatCents(cents);
}

function sumMoney(values: readonly (string | undefined)[]): string | undefined {
  const cents = values.map(toCents).filter((c): c is number => c !== undefined);
  return cents.length > 0 ? formatCents(cents.reduce((a, b) => a + b, 0)) : undefined;
}

function percent(value: string | undefined): string | undefined {
  return value === undefined ? undefined : `${value.replace('.', ',')}%`;
}

function date(value: string | undefined): string | undefined {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function dateTime(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const s = formatBrasiliaDateTime(parsed);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 19)}`;
}

export function formatDocument(type: 'CNPJ' | 'CPF' | 'NIF', value: string): string {
  if (type === 'CNPJ' && /^[0-9A-Z]{14}$/.test(value))
    return `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`;
  if (type === 'CPF' && /^\d{11}$/.test(value))
    return `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6, 9)}-${value.slice(9)}`;
  return value;
}

function rawDocument(party: El | undefined): string | undefined {
  return val(party, 'CNPJ') ?? val(party, 'CPF') ?? val(party, 'NIF');
}

function partyDocument(party: El | undefined, fallback?: El): string | undefined {
  for (const el of [party, fallback]) {
    const cnpj = val(el, 'CNPJ');
    if (cnpj) return formatDocument('CNPJ', cnpj);
    const cpf = val(el, 'CPF');
    if (cpf) return formatDocument('CPF', cpf);
    const nif = val(el, 'NIF');
    if (nif) return nif;
  }
  return undefined;
}

function formatCep(value: string | undefined): string | undefined {
  return value && /^\d{8}$/.test(value) ? `${value.slice(0, 2)}.${value.slice(2, 5)}-${value.slice(5)}` : value;
}

function ufOf(ibgeCode: string | undefined): string | undefined {
  return ibgeCode ? codes.UF_BY_IBGE[ibgeCode.slice(0, 2)] : undefined;
}

interface Party {
  document: string | undefined;
  municipalRegistration: string | undefined;
  phone: string | undefined;
  name: string | undefined;
  city: string | undefined;
  postalCode: string | undefined;
  address: string | undefined;
  email: string | undefined;
}

// The emitter group of the NFS-e fills what the DPS provider group leaves out.
function readParty(party: El | undefined, names: ReadonlyMap<string, string>, emit?: El): Party {
  const end = at(party, 'end');
  const national = at(end, 'endNac');
  const foreign = at(end, 'endExt');
  const emitAddress = end ? undefined : at(emit, 'enderNac');
  const line = end ?? emitAddress;
  const cMun = val(national, 'cMun') ?? val(emitAddress, 'cMun');
  const cep = val(national, 'CEP') ?? val(emitAddress, 'CEP');
  const pick = (name: string): string | undefined => val(party, name) ?? val(emit, name);
  const city = foreign
    ? join([val(foreign, 'xCidade'), val(foreign, 'xEstProvReg')], ' / ')
    : cMun === undefined
      ? undefined
      : join([names.get(cMun) ?? cMun, val(emitAddress, 'UF') ?? ufOf(cMun)], ' / ');
  return {
    document: partyDocument(party, emit),
    municipalRegistration: pick('IM'),
    phone: pick('fone'),
    name: pick('xNome'),
    city,
    postalCode: foreign ? val(foreign, 'cEndPost') : join([cMun, formatCep(cep)], ' / '),
    address: join([val(line, 'xLgr'), val(line, 'nro'), val(line, 'xCpl'), val(line, 'xBairro')], ', '),
    email: pick('email'),
  };
}

function taxesLine(totTrib: El | undefined): string {
  const monetary = at(totTrib, 'vTotTrib');
  const ratio = at(totTrib, 'pTotTrib');
  const simples = percent(val(totTrib, 'pTotTribSN'));
  if (simples !== undefined) return `${TAXES_LINE}: Simples Nacional: ${simples}`;
  const f = monetary ? money(val(monetary, 'vTotTribFed')) : percent(val(ratio, 'pTotTribFed'));
  const e = monetary ? money(val(monetary, 'vTotTribEst')) : percent(val(ratio, 'pTotTribEst'));
  const m = monetary ? money(val(monetary, 'vTotTribMun')) : percent(val(ratio, 'pTotTribMun'));
  return `${TAXES_LINE}: Federais: ${f ?? DASH}; Estaduais: ${e ?? DASH}; Municipais: ${m ?? DASH}`;
}

export function readDanfseData(xml: string): DanfseData {
  const root = parseXmlRoot(xml, 'NFSe');
  const inf = requiredChild(root, 'infNFSe');
  const id = inf.getAttribute('Id');
  if (!id) throw new NfseParseError('Missing infNFSe/@Id.');
  const accessKey = id.replace(/^NFS/, '');

  const dps = at(inf, 'DPS', 'infDPS');
  const emit = at(inf, 'emit');
  const nfseValues = at(inf, 'valores');
  const dpsValues = at(dps, 'valores');
  const ibsNfse = at(inf, 'IBSCBS');
  const ibsDps = at(dps, 'IBSCBS');
  const tribMun = at(dpsValues, 'trib', 'tribMun');
  const tribFed = at(dpsValues, 'trib', 'tribFed');
  const pisCofins = at(tribFed, 'piscofins');
  const locPrest = at(dps, 'serv', 'locPrest');
  const service = at(dps, 'serv', 'cServ');
  const infoCompl = at(dps, 'serv', 'infoCompl');

  const names = new Map<string, string>();
  const xLocEmi = val(inf, 'xLocEmi');
  const learn = (code: string | undefined, name: string | undefined): void => {
    if (code && name && !names.has(code)) names.set(code, name);
  };
  learn(val(dps, 'cLocEmi'), xLocEmi);
  learn(val(emit, 'enderNac', 'cMun'), xLocEmi);
  learn(val(locPrest, 'cLocPrestacao'), val(inf, 'xLocPrestacao'));
  learn(val(inf, 'cLocIncid'), val(inf, 'xLocIncid'));

  const prestParty = at(dps, 'prest');
  const tomaParty = at(dps, 'toma');
  const intermParty = at(dps, 'interm');
  const destParty = at(ibsDps, 'dest');
  const provider = readParty(prestParty, names, emit);
  const customerData = readParty(tomaParty, names);
  const recipientData = readParty(destParty, names);
  const intermediaryData = readParty(intermParty, names);

  const cTribNac = val(service, 'cTribNac');
  const cLocEmi = val(dps, 'cLocEmi');
  const emitUf = val(emit, 'enderNac', 'UF') ?? ufOf(cLocEmi);
  const placeParts = (code: string | undefined, name: string | undefined, country: string | undefined): string | undefined => {
    if (code === undefined && name === undefined) return country;
    return join([name ?? (code === undefined ? undefined : (names.get(code) ?? code)), ufOf(code), country], ' / ');
  };

  const reductions = [
    val(ibsNfse, 'valores', 'uf', 'pRedAliqUF'),
    val(ibsNfse, 'valores', 'mun', 'pRedAliqMun'),
    val(ibsNfse, 'valores', 'fed', 'pRedAliqCBS'),
  ];
  const piscofinsRetained = val(pisCofins, 'tpRetPisCofins') === '1';
  const reeRepRes = val(ibsNfse, 'valores', 'vCalcReeRepRes');
  const gIbs = at(ibsNfse, 'totCIBS', 'gIBS');
  const gCbs = at(ibsNfse, 'totCIBS', 'gCBS');
  const classification = at(ibsDps, 'valores', 'trib');
  const classificationGroup = at(classification, 'gIBSCBS');
  const cst = val(classification, 'CST') ?? val(classificationGroup, 'CST');
  const cClassTrib = val(classification, 'cClassTrib') ?? val(classificationGroup, 'cClassTrib');

  const portions = [
    val(infoCompl, 'xInfComp'),
    prefixed('NFS-e Subst.: ', val(dps, 'subst', 'chSubstda')),
    val(infoCompl, 'docRef'),
    prefixed('Cod. Obra: ', val(dps, 'serv', 'obra', 'cObra')),
    prefixed('Insc. Imob.: ', join(kids(at(ibsDps, 'imovel'), 'gUnidImob').map((e) => val(e, 'inscImobFisc')), ', ')),
    prefixed('Cod. Evt.: ', val(dps, 'serv', 'atvEvento', 'idAtvEvt')),
    val(infoCompl, 'idDocTec'),
    val(infoCompl, 'xPed'),
    join(kids(at(infoCompl, 'gItemPed'), 'xItemPed').map((e) => e.textContent?.trim() || undefined), ', '),
    val(inf, 'xOutInf'),
  ];
  const extra = join(portions, ' | ');
  const taxes = taxesLine(at(dpsValues, 'trib', 'totTrib'));

  const values: Values = {
    municipality: cTribNac?.startsWith('99') || xLocEmi === undefined ? undefined : `Município: ${join([xLocEmi, emitUf], ' / ')}`,
    generatorEnvironment: describe(codes.GENERATOR_ENVIRONMENT, val(inf, 'ambGer')),
    environmentType: describe(codes.ENVIRONMENT_TYPE, val(dps, 'tpAmb')),

    accessKey: accessKey || undefined,
    nfseNumber: val(inf, 'nNFSe'),
    competence: date(val(dps, 'dCompet')),
    nfseIssuedAt: dateTime(val(inf, 'dhProc')),
    dpsNumber: val(dps, 'nDPS'),
    dpsSeries: val(dps, 'serie'),
    dpsIssuedAt: dateTime(val(dps, 'dhEmi')),
    issuerType: describe(codes.ISSUER_TYPE, val(dps, 'tpEmit')),
    nfseStatus: describe(codes.NFSE_STATUS, val(inf, 'cStat')),
    purpose: describe(codes.PURPOSE, val(ibsDps, 'finNFSe') ?? val(dps, 'finNFSe')),

    providerDocument: provider.document,
    providerMunicipalRegistration: provider.municipalRegistration,
    providerPhone: provider.phone,
    providerName: provider.name,
    providerCity: provider.city,
    providerPostalCode: provider.postalCode,
    providerAddress: provider.address,
    providerEmail: provider.email,
    providerSimplesNacional: describe(codes.SIMPLES_NATIONAL, val(prestParty, 'regTrib', 'opSimpNac')),
    providerSimplesRegime: describe(codes.SIMPLES_REGIME, val(prestParty, 'regTrib', 'regApTribSN')),

    customerDocument: customerData.document,
    customerMunicipalRegistration: customerData.municipalRegistration,
    customerPhone: customerData.phone,
    customerName: customerData.name,
    customerCity: customerData.city,
    customerPostalCode: customerData.postalCode,
    customerAddress: customerData.address,
    customerEmail: customerData.email,

    recipientDocument: recipientData.document,
    recipientPhone: recipientData.phone,
    recipientName: recipientData.name,
    recipientCity: recipientData.city,
    recipientPostalCode: recipientData.postalCode,
    recipientAddress: recipientData.address,
    recipientEmail: recipientData.email,

    intermediaryDocument: intermediaryData.document,
    intermediaryMunicipalRegistration: intermediaryData.municipalRegistration,
    intermediaryPhone: intermediaryData.phone,
    intermediaryName: intermediaryData.name,
    intermediaryCity: intermediaryData.city,
    intermediaryPostalCode: intermediaryData.postalCode,
    intermediaryAddress: intermediaryData.address,
    intermediaryEmail: intermediaryData.email,

    serviceTaxCode: join([cTribNac?.replace(/^(\d{2})(\d{2})(\d{2})$/, '$1.$2.$3'), val(service, 'cTribMun')], ' / '),
    serviceNbs: val(service, 'cNBS')?.replace(/^(\d)(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3.$4'),
    serviceLocation: placeParts(val(locPrest, 'cLocPrestacao'), val(inf, 'xLocPrestacao'), val(locPrest, 'cPaisPrestacao')),
    serviceTaxCodeDescription: val(inf, 'xTribMun') ?? val(inf, 'xTribNac'),
    serviceDescription: val(service, 'xDescServ'),

    issqnTaxation: describe(codes.ISSQN_TAXATION, val(tribMun, 'tribISSQN')),
    issqnIncidence: placeParts(val(inf, 'cLocIncid'), val(inf, 'xLocIncid'), val(tribMun, 'cPaisResult')),
    issqnSpecialRegime: describe(codes.SPECIAL_REGIME, val(prestParty, 'regTrib', 'regEspTrib')),
    issqnImmunity: describe(codes.ISSQN_IMMUNITY, val(tribMun, 'tpImunidade')),
    issqnSuspension: describe(codes.ISSQN_SUSPENSION, val(tribMun, 'exigSusp', 'tpSusp')),
    issqnSuspensionProcess: val(tribMun, 'exigSusp', 'nProcesso'),
    municipalBenefit: describe(codes.MUNICIPAL_BENEFIT, val(nfseValues, 'tpBM')),
    municipalBenefitCalc: money(val(nfseValues, 'vCalcBM') ?? val(tribMun, 'BM', 'vRedBCBM')),
    deductions: money(val(dpsValues, 'vDedRed', 'vDR')) ?? sumMoney([val(nfseValues, 'vCalcDR'), reeRepRes]),
    issqnUnconditionalDiscount: money(val(dpsValues, 'vDescCondIncond', 'vDescIncond')),
    issqnBase: money(val(nfseValues, 'vBC')),
    issqnRate: percent(val(nfseValues, 'pAliqAplic')),
    issqnWithholding: describe(codes.ISSQN_WITHHOLDING, val(tribMun, 'tpRetISSQN')),
    issqnAmount: money(val(nfseValues, 'vISSQN')),

    irrf: money(val(tribFed, 'vRetIRRF')),
    socialSecurityWithheld: money(val(tribFed, 'vRetCP')),
    socialContributionsWithheld: piscofinsRetained
      ? sumMoney([val(tribFed, 'vRetCSLL'), val(pisCofins, 'vPis'), val(pisCofins, 'vCofins')])
      : money(val(tribFed, 'vRetCSLL')),
    pisAmount: piscofinsRetained ? formatCents(0) : money(val(pisCofins, 'vPis')),
    cofinsAmount: piscofinsRetained ? formatCents(0) : money(val(pisCofins, 'vCofins')),
    socialContributionsDescription: describe(codes.PIS_COFINS_WITHHOLDING, val(pisCofins, 'tpRetPisCofins')),

    ibsCbsClassification: join([cst, cClassTrib], ' / '),
    ibsCbsOperation: join(
      [val(ibsDps, 'cIndOp') ?? val(ibsNfse, 'cIndOp'), val(ibsNfse, 'cLocalidadeIncid'), val(ibsNfse, 'xLocalidadeIncid'), ufOf(val(ibsNfse, 'cLocalidadeIncid'))],
      ' / ',
    ),
    ibsCbsExclusions: ibsNfse
      ? sumMoney([val(dpsValues, 'vDescCondIncond', 'vDescIncond'), reeRepRes, val(nfseValues, 'vISSQN'), val(pisCofins, 'vPis'), val(pisCofins, 'vCofins')])
      : undefined,
    ibsCbsBase: money(val(ibsNfse, 'valores', 'vBC')),
    ibsCbsRateReductions: reductions.every((r) => r === undefined) ? undefined : reductions.map((r) => percent(r) ?? DASH).join(' / '),
    ibsRates: join([percent(val(ibsNfse, 'valores', 'uf', 'pIBSUF')), percent(val(ibsNfse, 'valores', 'mun', 'pIBSMun'))], ' / '),
    ibsMunicipalEffectiveRate: percent(val(ibsNfse, 'valores', 'mun', 'pAliqEfetMun')),
    ibsMunicipalAmount: money(val(gIbs, 'gIBSMunTot', 'vIBSMun')),
    ibsStateEffectiveRate: percent(val(ibsNfse, 'valores', 'uf', 'pAliqEfetUF')),
    ibsStateAmount: money(val(gIbs, 'gIBSUFTot', 'vIBSUF')),
    ibsTotalAmount: money(val(gIbs, 'vIBSTot')),
    cbsRate: percent(val(ibsNfse, 'valores', 'fed', 'pCBS')),
    cbsEffectiveRate: percent(val(ibsNfse, 'valores', 'fed', 'pAliqEfetCBS')),
    cbsAmount: money(val(gCbs, 'vCBS')),

    serviceAmount: money(val(dpsValues, 'vServPrest', 'vServ')),
    totalUnconditionalDiscount: money(val(dpsValues, 'vDescCondIncond', 'vDescIncond')),
    conditionalDiscount: money(val(dpsValues, 'vDescCondIncond', 'vDescCond')),
    totalWithholdings: money(val(nfseValues, 'vTotalRet')),
    netAmount: money(val(nfseValues, 'vLiq')),
    ibsCbsTotal: sumMoney([val(gIbs, 'vIBSTot'), val(gCbs, 'vCBS')]),
    netAmountWithIbsCbs: money(val(ibsNfse, 'totCIBS', 'vTotNF')),

    // The taxes line is mandatory (note 10), so only the other parts are cut.
    complementaryInfo: extra === undefined ? taxes : `${cut(extra, 2000)} | ${taxes}`,
  };

  const fields = {} as Record<FieldKey, string>;
  for (const f of FIELDS) {
    if (f.xmlPath === '') {
      fields[f.key] = '';
      continue;
    }
    const raw = values[f.key as keyof Values] ?? DASH;
    fields[f.key] = f.maxChars === undefined || UNCUT.has(f.key) ? raw : cut(raw, f.maxChars);
  }

  const customer = tomaParty ? 'present' : 'absent';
  const destDocument = rawDocument(destParty);
  const recipient = destParty
    ? destDocument !== undefined && destDocument === rawDocument(tomaParty) ? 'same' : 'present'
    : tomaParty ? 'same' : 'absent';

  return {
    fields,
    accessKey,
    testEnvironment: val(dps, 'tpAmb') === '2',
    customer,
    recipient,
    intermediary: intermParty ? 'present' : 'absent',
    issqn: ['2', '3', '4'].includes(val(tribMun, 'tribISSQN') ?? '') ? 'notSubject' : 'present',
  };
}

function prefixed(prefix: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : `${prefix}${value}`;
}
