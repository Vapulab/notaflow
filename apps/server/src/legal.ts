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
  id: '2026-10-28-danfse',
  date: '2026-10-28',
  text: 'Atualizamos a política de privacidade. O NotaFlow agora gera o PDF das notas e o guarda na Cloudflare. Você pode criar um link público da nota e enviá-lo ao tomador por e-mail. Quem tem o link vê o PDF da nota até você revogar o link.',
  href: '/privacidade',
};

// The version that announced the lifecycle reminders: only users who accepted it, or a later one, get them.
export const LIFECYCLE_LEGAL_VERSION = '2026-10-12.2';
