export { buildDpsId } from './dps/buildDpsId';
export { buildDpsXml, NFSE_NAMESPACE, SCHEMA_VERSION } from './dps/buildDpsXml';
export type { Address, DpsInput, Environment, ForeignAddress, ForeignTrade } from './dps/types';
export { escapeXml } from './xml/escapeXml';
export {
  centsToDecimal,
  decimalToCents,
  formatBrasiliaDate,
  formatBrasiliaDateTime,
} from './xml/formatters';
export { parseEventXml } from './parse/parseEventXml';
export { parseNfseXml } from './parse/parseNfseXml';
export { NfseParseError } from './xml/readXml';
export { buildCancelEventXml } from './events/buildCancelEventXml';
export type { CancelEventInput, CancelReason } from './events/buildCancelEventXml';
export { createMtlsDispatcher } from './http/createMtlsDispatcher';
export { ENDPOINTS } from './http/endpoints';
export { gunzipBase64, gzipBase64 } from './http/gzipBase64';
export { isDuplicateDps, NacionalClient, NacionalHttpError } from './http/NacionalClient';
export { NacionalIssuer } from './NacionalIssuer';
export { NacionalProvider } from './NacionalProvider';
export { applyTemplate } from './template/applyTemplate';
export { readTemplate, TemplateUnsupportedError } from './template/readTemplate';
export type { DpsTemplate } from './template/readTemplate';
export type {
  DfeBatch,
  DfeDocument,
  DpsLookup,
  EventResult,
  IssueResult,
  SefinError,
} from './http/NacionalClient';
export { buildTemplate } from './template/buildTemplate';
export { percentText, SIMPLES_BANDS } from './rules/simplesBands';
export { type SimplesAnnex, simplesBand, simplesRate } from './rules/simplesRates';
export { minimumIssRate, taxRules } from './rules/taxRules';
export type { CustomerRules, RuleSet } from './rules/taxRules';
