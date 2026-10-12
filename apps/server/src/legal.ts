// One version for the terms and the privacy policy; a new version asks every user to accept again.
// Only a material change gets a new version (terms, clause 14); any other change is a POLICY_NOTICE.
export const LEGAL_VERSION = '2026-10-12';

export interface PolicyNotice {
  id: string;
  date: string;
  text: string;
  href: string;
}

// An update that applies when published and is shown once in the app; null when there is none.
export const POLICY_NOTICE: PolicyNotice | null = null;
