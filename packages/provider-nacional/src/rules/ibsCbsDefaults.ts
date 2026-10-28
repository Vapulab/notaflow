import anexo8 from './anexo8.json';

export interface IbsCbsDefaults {
  operationCode: string;
  cst: string;
  classCode: string;
}

const TABLE: Readonly<Record<string, { operationCode: string; classCode: string } | undefined>> = anexo8;

// Checked in produção restrita on 2026-10-21; used when the Anexo VIII has no full row.
const FALLBACK = { operationCode: '100301', classCode: '000001' };

/** The IBSCBS defaults of an LC 116 item (the first 4 digits of cTribNac), from the Anexo VIII. */
export function ibsCbsDefaults(nationalTaxCode: string): IbsCbsDefaults {
  const row = TABLE[nationalTaxCode.slice(0, 4)] ?? FALLBACK;
  return { operationCode: row.operationCode, cst: row.classCode.slice(0, 3), classCode: row.classCode };
}
