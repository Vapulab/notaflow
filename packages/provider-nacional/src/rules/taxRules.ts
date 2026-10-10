export interface CustomerRules {
  issqnTaxation: '1' | '3'; // 1 taxable in the municipality, 3 export
  usesIssRate: boolean;
  foreignTrade: boolean;
}

export interface RuleSet {
  forCustomer(abroad: boolean): CustomerRules;
}

// 2026: the IBSCBS group is optional for the Simples (NT 004 v2).
const rules2026: RuleSet = {
  forCustomer: (abroad) =>
    abroad
      ? { issqnTaxation: '3', usesIssRate: false, foreignTrade: true }
      : { issqnTaxation: '1', usesIssRate: true, foreignTrade: false },
};

export function taxRules(competence: string): RuleSet {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(competence)) {
    throw new RangeError(`The competence must be YYYY-MM-DD: ${competence}`);
  }
  if (competence < '2027-01-01') return rules2026;
  throw new RangeError('NotaFlow has no tax rules for 2027 yet (IBS/CBS, NT 009).');
}

// LC 116/2003, art. 8-A: 2.00% at least, except subitems 7.02, 7.05, and 16.01; in hundredths.
const BELOW_MINIMUM_ALLOWED = ['0702', '0705', '1601'];

export function minimumIssRate(nationalTaxCode: string): number {
  return BELOW_MINIMUM_ALLOWED.includes(nationalTaxCode.slice(0, 4)) ? 1 : 200;
}
