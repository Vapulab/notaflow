import { decimalToCents } from '../xml/formatters';
import { child, parseXmlRoot, requiredChild, text } from '../xml/readXml';

type El = NonNullable<ReturnType<typeof child>>;

export type ReportCents = {
  service: number | null;
  net: number | null;
  iss: number | null;
  pis: number | null;
  cofins: number | null;
  ibsUf: number | null;
  ibsMun: number | null;
  cbs: number | null;
  retCp: number | null;
  retIrrf: number | null;
  retCsll: number | null;
  totalRet: number | null;
  discountUncond: number | null;
  discountCond: number | null;
  deduction: number | null;
};

export type ReportFields = {
  number?: string | undefined;
  competence?: string | undefined;
  issuedAt?: string | undefined;
  municipality?: string | undefined;
  nationalCode?: string | undefined;
  nbsCode?: string | undefined;
  issWithholding?: string | undefined;
  issRate?: string | undefined;
  pisCofinsWithholding?: string | undefined;
  cst?: string | undefined;
  cents: ReportCents;
};

function at(el: El | undefined, ...names: string[]): string | undefined {
  return el ? text(el, ...names)?.trim() || undefined : undefined;
}

function sub(el: El | undefined, ...names: string[]): El | undefined {
  let current = el;
  for (const name of names) current = current ? child(current, name) : undefined;
  return current;
}

// A present but malformed amount throws: the caller treats the whole row as "no XML".
function cents(el: El | undefined, ...names: string[]): number | null {
  const value = at(el, ...names);
  return value === undefined ? null : decimalToCents(value);
}

export function readReportFields(xml: string): ReportFields {
  const root = parseXmlRoot(xml, 'NFSe');
  const inf = requiredChild(root, 'infNFSe');
  const dps = sub(inf, 'DPS', 'infDPS');
  const nfseValues = sub(inf, 'valores');
  const dpsValues = sub(dps, 'valores');
  const tribMun = sub(dpsValues, 'trib', 'tribMun');
  const tribFed = sub(dpsValues, 'trib', 'tribFed');
  const pisCofins = sub(tribFed, 'piscofins');
  const discounts = sub(dpsValues, 'vDescCondIncond');
  const totals = sub(inf, 'IBSCBS', 'totCIBS');

  return {
    number: at(inf, 'nNFSe'),
    competence: at(dps, 'dCompet')?.slice(0, 10),
    issuedAt: at(dps, 'dhEmi'),
    municipality: at(inf, 'xLocIncid'),
    nationalCode: at(dps, 'serv', 'cServ', 'cTribNac'),
    nbsCode: at(dps, 'serv', 'cServ', 'cNBS'),
    issWithholding: at(tribMun, 'tpRetISSQN'),
    issRate: at(tribMun, 'pAliq') ?? at(nfseValues, 'pAliqAplic'),
    pisCofinsWithholding: at(pisCofins, 'tpRetPisCofins'),
    cst: at(pisCofins, 'CST'),
    cents: {
      service: cents(dpsValues, 'vServPrest', 'vServ'),
      net: cents(nfseValues, 'vLiq'),
      iss: cents(nfseValues, 'vISSQN'),
      pis: cents(pisCofins, 'vPis'),
      cofins: cents(pisCofins, 'vCofins'),
      ibsUf: cents(totals, 'gIBS', 'gIBSUFTot', 'vIBSUF'),
      ibsMun: cents(totals, 'gIBS', 'gIBSMunTot', 'vIBSMun'),
      cbs: cents(totals, 'gCBS', 'vCBS'),
      retCp: cents(tribFed, 'vRetCP'),
      retIrrf: cents(tribFed, 'vRetIRRF'),
      retCsll: cents(tribFed, 'vRetCSLL'),
      totalRet: cents(nfseValues, 'vTotalRet'),
      discountUncond: cents(discounts, 'vDescIncond'),
      discountCond: cents(discounts, 'vDescCond'),
      deduction: cents(dpsValues, 'vDedRed', 'vDR'),
    },
  };
}

export function issRetained(code: string | undefined): boolean {
  return code === '2' || code === '3';
}

const PIS_COFINS: Record<string, { pis: boolean; cofins: boolean }> = {
  '1': { pis: true, cofins: true },
  '3': { pis: true, cofins: true },
  '4': { pis: true, cofins: true },
  '5': { pis: true, cofins: false },
  '9': { pis: true, cofins: false },
  '6': { pis: false, cofins: true },
  '7': { pis: false, cofins: true },
};

export function pisCofinsRetained(code: string | undefined): { pis: boolean; cofins: boolean } {
  return (code === undefined ? undefined : PIS_COFINS[code]) ?? { pis: false, cofins: false };
}
