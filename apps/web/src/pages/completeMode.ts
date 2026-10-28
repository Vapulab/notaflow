import { type IbsCbsDefaults, ibsCbsDefaults } from '@notaflow/provider-nacional/simples';
import type { Customer, FiscalConfig, Service, ServiceCode, ServiceExport } from '../api';
import { centsInput, formatServiceCode, parseCents, parsePercent, percentInput } from '../format';

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
  inssRetained: boolean;
  inssAmount: string;
  simplesOther: string;
  code: ServiceCode | null;
  municipalTaxCode: string;
  nbsCode: string;
  pisCofinsCst: string;
  operationCode: string;
  cst: string;
  classCode: string;
  // False: a Brazil invoice shows the codes of the service or the Anexo VIII, which follow the code.
  ibsCbsEdited: boolean;
  export: Record<ExportField, string>;
}

// The patch for a change of national code: typed IBS/CBS codes that still equal the defaults of the
// old item go back to following the defaults, so they move to the new item.
export function withCode(
  more: Complete,
  service: Service | null,
  abroad: boolean,
  code: ServiceCode | null,
): Partial<Complete> {
  if (!more.ibsCbsEdited || abroad || !service) return { code };
  const old = domesticIbsCbs(service, more.code?.code ?? service.nationalTaxCode);
  const same = JSON.stringify(ibsCbsShown(more, service, abroad)) === JSON.stringify(old);
  return same ? { code, ibsCbsEdited: false } : { code };
}

const IBS_CBS_PATTERN = [
  ['operationCode', /^\d{6}$/],
  ['cst', /^\d{3}$/],
  ['classCode', /^\d{6}$/],
] as const;

// What a Brazil invoice carries when nobody types: the service's own codes, else the Anexo VIII.
// A service with export details keeps its codes for the export only.
export function domesticIbsCbs(service: Service, nationalTaxCode: string): IbsCbsDefaults {
  return (service.export ? undefined : service.ibsCbs) ?? ibsCbsDefaults(nationalTaxCode);
}

// The three IBS/CBS fields as the form shows them.
export function ibsCbsShown(
  more: Complete,
  service: Service | null,
  abroad: boolean,
): IbsCbsDefaults {
  if (abroad || more.ibsCbsEdited || !service) {
    return { operationCode: more.operationCode, cst: more.cst, classCode: more.classCode };
  }
  return domesticIbsCbs(service, more.code?.code ?? service.nationalTaxCode);
}

export function isAbroad(customer: Customer | null): boolean {
  return customer !== null && customer.documentType !== 'CNPJ' && customer.documentType !== 'CPF';
}

// A customer flip between Brazil and abroad drops the typed codes: the two modes do not share them.
export function withCustomerMode(more: Complete, service: Service | null): Complete {
  const { operationCode, cst, classCode, ibsCbsEdited } = serviceFields(service);
  return { ...more, operationCode, cst, classCode, ibsCbsEdited };
}

export function completeFrom(service: Service | null, config: FiscalConfig): Complete {
  const retainedRate = config.rates?.iss ?? config.issRate;
  return {
    issRetained: false,
    issRate: retainedRate === null ? '' : percentInput(retainedRate),
    inssRetained: false,
    inssAmount: '',
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
    ibsCbsEdited: false,
    export: Object.fromEntries(EXPORT_FIELDS.map((f) => [f, service?.export?.[f] ?? ''])) as Record<
      ExportField,
      string
    >,
  };
}

export interface CompleteBody {
  issRetained?: true;
  issRate?: number;
  inssRetainedCents?: number;
  simplesPercent?: number;
  overrides?: Record<string, unknown>;
}

// What goes to POST invoices/new, and the lines the review shows under "Alterado nesta nota".
// null when a typed percent is not a number.
export function completeBody(
  more: Complete,
  service: Service,
  // bandIss: the ISS share of the band, which the server applies when no rate is sent.
  options: {
    canRetain: boolean;
    abroad: boolean;
    bandIss: number | null;
    serviceCents: number | null;
  },
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
  if (options.canRetain && more.inssRetained) {
    const cents = parseCents(more.inssAmount);
    if (cents === null || cents <= 0 || options.serviceCents === null) return null;
    if (cents >= options.serviceCents) return null;
    body.inssRetainedCents = cents;
    changes.push(`INSS retido pelo cliente: R$ ${centsInput(cents)}`);
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
  const shown = ibsCbsShown(more, service, options.abroad);
  const ibsCbs = {
    operationCode: shown.operationCode.trim(),
    cst: shown.cst.trim(),
    classCode: shown.classCode.trim(),
  };
  const ibsCbsValues = [ibsCbs.operationCode, ibsCbs.cst, ibsCbs.classCode];
  const ibsCbsDone = ibsCbsValues.every(Boolean);
  // A half-filled group is refused, not dropped.
  if (!ibsCbsDone && ibsCbsValues.some(Boolean)) return null;
  // An export compares with the codes of the service; a Brazil invoice with the defaults.
  const ibsCbsBase = options.abroad
    ? (service.ibsCbs ?? null)
    : domesticIbsCbs(service, more.code?.code ?? service.nationalTaxCode);
  if (ibsCbsDone && JSON.stringify(ibsCbs) !== JSON.stringify(ibsCbsBase)) {
    if (!IBS_CBS_PATTERN.every(([field, pattern]) => pattern.test(ibsCbs[field]))) return null;
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
