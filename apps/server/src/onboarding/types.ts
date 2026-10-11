export const ONBOARDING_STEPS = [
  'company',
  'card',
  'certificate',
  'fiscal',
  'sync',
  'done',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

// What the card and the public lookup established, confirmed before the certificate step.
export interface CnpjDraft {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  municipality: string;
  uf: string;
  cnae: string | null;
  // The main activity in words, shown when the fiscal step asks about the Simples annex.
  cnaeDescription: string | null;
  simplesNacional: '1' | '2' | '3';
  source: 'brasilapi' | 'cnpja';
}
