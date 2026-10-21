// NotaFlow's own tables, not official ones: LC 123, art. 18, names the activities of each annex only in
// words (Res. CGSN 140, art. 25, §1º), and no CGSN annex links them to CNAEs. They only suggest.
// Keys are CNAE prefixes (2 to 7 digits).
const FATOR_R = [
  // §5º-D: software, web pages, real estate administration, gyms, laboratories, imaging, prostheses.
  '6201501',
  '6201502',
  '6202300',
  '6203100',
  '6204000',
  '6822600',
  '8591100',
  '8592901',
  '9313100',
  // §5º-I VI and VIII: engineering, architecture, surveying, technical tests, research, design, appraisal.
  '7111100',
  '7112000',
  '7119',
  '7120100',
  '72',
  '7410203',
  '7410299',
  // §5º-I V, VII, IX to XI: dispatchers, translation, sales agents, audit, consulting, advertising.
  '5250801',
  '5250802',
  '461',
  '6920602',
  '7020400',
  '731',
  '7320300',
  '7490101',
  '7490104',
  // §5º-I II and §5º-M: veterinary, medicine, dentistry, physiotherapy, psychology, and similar.
  '7500100',
  '86',
];

// §5º-C: works and landscaping, cleaning and security, and law firms pay the CPP outside the DAS.
const ANNEX_IV = ['412', '42', '43', '7410202', '8130300', '80111', '8012900', '812', '6911701'];

export type AnnexRule = 'III' | 'IV' | 'fator_r';

// The annex the main activity (the first CNAE) suggests; fator_r moves between Anexos III and V.
export function annexRule(cnaes: string[] | null): AnnexRule | null {
  const main = cnaes?.[0];
  if (!main) return null;
  if (ANNEX_IV.some((prefix) => main.startsWith(prefix))) return 'IV';
  return FATOR_R.some((prefix) => main.startsWith(prefix)) ? 'fator_r' : 'III';
}
