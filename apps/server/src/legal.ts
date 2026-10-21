// One version for the terms and the privacy policy; a new version asks every user to accept again.
// Only a material change gets a new version (terms, clause 14); any other change is a POLICY_NOTICE.
export const LEGAL_VERSION = '2026-10-12.2';

export interface PolicyNotice {
  id: string;
  date: string;
  text: string;
  href: string;
}

// An update that applies when published and is shown once in the app; null when there is none.
export const POLICY_NOTICE: PolicyNotice | null = {
  id: '2026-10-21-simples-annexes',
  date: '2026-10-21',
  text: 'Os termos de uso agora dizem que o NotaFlow atende empresas de todos os anexos do Simples Nacional (I a V).',
  href: '/termos',
};

// The version that announced the lifecycle reminders: only users who accepted it, or a later one, get them.
export const LIFECYCLE_LEGAL_VERSION = '2026-10-12.2';
