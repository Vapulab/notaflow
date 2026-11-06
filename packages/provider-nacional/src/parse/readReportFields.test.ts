import { describe, expect, it } from 'vitest';
import { readFixture } from '../../test/fixtures';
import { NfseParseError } from '../xml/readXml';
import { issRetained, pisCofinsRetained, readReportFields } from './readReportFields';

const GROUPS =
  '<tribFed><piscofins><CST>01</CST><vPis>10.00</vPis><vCofins>46.17</vCofins><tpRetPisCofins>1</tpRetPisCofins></piscofins>' +
  '<vRetCP>11.00</vRetCP><vRetIRRF>22.50</vRetIRRF><vRetCSLL>33.05</vRetCSLL></tribFed>';
const DISCOUNTS = '<vDescCondIncond><vDescIncond>5.00</vDescIncond><vDescCond>7.25</vDescCond></vDescCondIncond>';
const IBSCBS =
  '<IBSCBS><totCIBS><gIBS><vIBSTot>3.00</vIBSTot><gIBSUFTot><vIBSUF>1.10</vIBSUF></gIBSUFTot>' +
  '<gIBSMunTot><vIBSMun>1.90</vIBSMun></gIBSMunTot></gIBS><gCBS><vCBS>4.31</vCBS></gCBS></totCIBS></IBSCBS>';

// The fixtures carry none of these groups, so the tests add them.
function withGroups(): string {
  return readFixture('NFSE_DOMESTIC.xml')
    .replace('<vISSQN>', '<vTotalRet>66.55</vTotalRet><vISSQN>')
    .replace('<xLocEmi>', '<xLocIncid>Sao Paulo</xLocIncid><xLocEmi>')
    .replace('</tribMun>', '<pAliq>2.00</pAliq></tribMun>' + GROUPS)
    .replace('</vServPrest>', '</vServPrest>' + DISCOUNTS)
    .replace('</infDPS></DPS>', '</infDPS></DPS>' + IBSCBS);
}

describe('readReportFields', () => {
  it('reads the domestic invoice', () => {
    const r = readReportFields(readFixture('NFSE_DOMESTIC.xml'));
    expect(r.number).toBe('42');
    expect(r.competence).toBe('2026-09-30');
    expect(r.issuedAt).toBe('2026-10-01T10:00:00-03:00');
    expect(r.nationalCode).toBe('010101');
    expect(r.nbsCode).toBe('115022000');
    expect(r.issWithholding).toBe('1');
    expect(r.cents.service).toBe(150000);
    expect(r.cents.net).toBe(147000);
    expect(r.cents.iss).toBe(3000);
  });

  it('reads the IBS/CBS and retention groups', () => {
    const r = readReportFields(withGroups());
    expect(r.municipality).toBe('Sao Paulo');
    expect(r.issRate).toBe('2.00');
    expect(r.pisCofinsWithholding).toBe('1');
    expect(r.cst).toBe('01');
    expect(r.cents).toMatchObject({
      pis: 1000,
      cofins: 4617,
      ibsUf: 110,
      ibsMun: 190,
      cbs: 431,
      retCp: 1100,
      retIrrf: 2250,
      retCsll: 3305,
      totalRet: 6655,
      discountUncond: 500,
      discountCond: 725,
    });
  });

  it('reads a sparse invoice', () => {
    const xml = withGroups().replace(IBSCBS, '').replace(GROUPS, '').replace(DISCOUNTS, '');
    const r = readReportFields(xml);
    expect(r.cents.ibsUf).toBeNull();
    expect(r.cents.pis).toBeNull();
    expect(r.cents.discountCond).toBeNull();
    expect(r.cents.service).toBe(150000);
  });

  it('throws on a malformed amount', () => {
    const xml = readFixture('NFSE_DOMESTIC.xml').replace('<vLiq>1470.00</vLiq>', '<vLiq>abc</vLiq>');
    expect(() => readReportFields(xml)).toThrow();
  });

  it('maps the retention codes', () => {
    const table: Record<string, [boolean, boolean]> = {
      '0': [false, false],
      '2': [false, false],
      '8': [false, false],
      '1': [true, true],
      '3': [true, true],
      '4': [true, true],
      '5': [true, false],
      '9': [true, false],
      '6': [false, true],
      '7': [false, true],
    };
    for (const [code, [pis, cofins]] of Object.entries(table))
      expect(pisCofinsRetained(code)).toEqual({ pis, cofins });
    expect(pisCofinsRetained(undefined)).toEqual({ pis: false, cofins: false });
    expect(pisCofinsRetained('x')).toEqual({ pis: false, cofins: false });
    expect(issRetained('1')).toBe(false);
    expect(issRetained('2')).toBe(true);
    expect(issRetained('3')).toBe(true);
    expect(issRetained(undefined)).toBe(false);
  });

  it('throws on a non-NFS-e root', () => {
    expect(() => readReportFields('<x/>')).toThrow(NfseParseError);
  });
});
