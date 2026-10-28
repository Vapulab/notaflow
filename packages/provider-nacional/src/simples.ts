// The browser entry: pure rules only, so the bundle pulls no HTTP client and no signer.
export { type AnnexRule, annexRule } from './rules/annexRule';
export {
  addMonths,
  fatorR,
  monthIndex,
  monthName,
  rbt12Window,
  type RetainedIss,
  type RevenueKind,
  simplesMonth,
  type SimplesMonth,
  type SimplesMonthLine,
} from './rules/simplesMonth';
export {
  BAND6_ISS,
  type Band6Iss,
  SIMPLES_ANNEXES,
  type SimplesAnnex,
  simplesBand,
  simplesBreakdown,
  simplesIssRate,
  simplesRate,
  type SimplesShares,
  simplesShares,
  type SimplesTax,
  type TaxSplit,
} from './rules/simplesRates';
export { type IbsCbsDefaults, ibsCbsDefaults } from './rules/ibsCbsDefaults';
