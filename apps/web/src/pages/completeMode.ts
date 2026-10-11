import type { FiscalConfig, Service, ServiceCode, ServiceExport } from '../api';
import { formatServiceCode, parsePercent, percentInput } from '../format';

export type ExportField = keyof ServiceExport;
export const EXPORT_FIELDS: ExportField[] = [
  'mode',
  'providerLink',
  'providerSupport',
  'customerSupport',
  'temporaryGoods',
  'mdic',
];

// "Mais opções" of Nova nota: per-invoice changes to the service and the emitter defaults.
export interface Complete {
  issRetained: boolean;
  issRate: string;
  simplesOther: string;
  code: ServiceCode | null;
  municipalTaxCode: string;
  nbsCode: string;
  pisCofinsCst: string;
  operationCode: string;
  cst: string;
  classCode: string;
  export: Record<ExportField, string>;
}

export function completeFrom(service: Service | null, config: FiscalConfig): Complete {
  const retainedRate = config.rates?.iss ?? config.issRate;
  return {
    issRetained: false,
    issRate: retainedRate === null ? '' : percentInput(retainedRate),
    simplesOther: '',
    ...serviceFields(service),
  };
}

// The fields that come from the service; a new service resets them.
export function serviceFields(service: Service | null) {
  return {
    code: service ? { code: service.nationalTaxCode, description: '' } : null,
    municipalTaxCode: service?.municipalTaxCode ?? '',
    nbsCode: service?.nbsCode ?? '',
    pisCofinsCst: service?.pisCofinsCst ?? '',
    operationCode: service?.ibsCbs?.operationCode ?? '',
    cst: service?.ibsCbs?.cst ?? '',
    classCode: service?.ibsCbs?.classCode ?? '',
    export: Object.fromEntries(EXPORT_FIELDS.map((f) => [f, service?.export?.[f] ?? ''])) as Record<
      ExportField,
      string
    >,
  };
}

export interface CompleteBody {
  issRetained?: true;
  issRate?: number;
  simplesPercent?: number;
  overrides?: Record<string, unknown>;
}

// What goes to POST invoices/new, and the lines the review shows under "Alterado nesta nota".
// null when a typed percent is not a number.
export function completeBody(
  more: Complete,
  service: Service,
  // bandIss: the ISS share of the band, which the server applies when no rate is sent.
  options: { canRetain: boolean; abroad: boolean; bandIss: number | null },
): { body: CompleteBody; changes: string[] } | null {
  const body: CompleteBody = {};
  const changes: string[] = [];
  if (options.canRetain && more.issRetained) {
    const rate = parsePercent(more.issRate);
    // LC 116 caps the ISS at 5%.
    if (rate === null || rate > 500) return null;
    body.issRetained = true;
    if (rate !== options.bandIss) body.issRate = rate;
    changes.push(`ISS retido pelo cliente: ${percentInput(rate)}%`);
  }
  if (more.simplesOther.trim()) {
    const percent = parsePercent(more.simplesOther);
    // pTotTribSN is at most 99.99.
    if (percent === null || percent === 0 || percent > 9_999) return null;
    body.simplesPercent = percent;
    changes.push(`Percentual do Simples: ${percentInput(percent)}%`);
  }
  const overrides: Record<string, unknown> = {};
  const changed = (field: 'municipalTaxCode' | 'nbsCode' | 'pisCofinsCst', label: string) => {
    const value = more[field].trim();
    if (value && value !== (service[field] ?? '')) {
      overrides[field] = value;
      changes.push(`${label}: ${value}`);
    }
  };
  if (more.code && more.code.code !== service.nationalTaxCode) {
    overrides.nationalTaxCode = more.code.code;
    changes.push(`Código nacional: ${formatServiceCode(more.code.code)}`);
  }
  changed('municipalTaxCode', 'Código municipal');
  changed('nbsCode', 'NBS');
  changed('pisCofinsCst', 'CST do PIS/COFINS');
  const ibsCbs = {
    operationCode: more.operationCode.trim(),
    cst: more.cst.trim(),
    classCode: more.classCode.trim(),
  };
  const ibsCbsValues = [ibsCbs.operationCode, ibsCbs.cst, ibsCbs.classCode];
  const ibsCbsDone = ibsCbsValues.every(Boolean);
  // 2026: only an export carries the group; a half-filled group is refused, not dropped.
  if (options.abroad && !ibsCbsDone && ibsCbsValues.some(Boolean)) return null;
  if (
    options.abroad &&
    ibsCbsDone &&
    JSON.stringify(ibsCbs) !== JSON.stringify(service.ibsCbs ?? null)
  ) {
    overrides.ibsCbs = ibsCbs;
    changes.push(`IBS/CBS: ${ibsCbs.operationCode}, CST ${ibsCbs.cst}, ${ibsCbs.classCode}`);
  }
  const exportDone = EXPORT_FIELDS.every((f) => more.export[f] !== '');
  const exportStarted = EXPORT_FIELDS.some((f) => more.export[f] !== '');
  if (options.abroad && exportStarted && !exportDone) return null;
  if (options.abroad && exportDone) {
    const differs = EXPORT_FIELDS.some((f) => more.export[f] !== (service.export?.[f] ?? ''));
    if (differs) {
      overrides.export = more.export;
      changes.push('Dados de exportação alterados');
    }
  }
  if (Object.keys(overrides).length > 0) body.overrides = overrides;
  return { body, changes };
}
