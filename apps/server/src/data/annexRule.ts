// NotaFlow's own tables, not official ones: LC 123, art. 18, names the activities of each annex only in
// words (Res. CGSN 140, art. 25, §1º), and no CGSN annex links them to CNAEs. They only suggest.
// Keys are CNAE prefixes (2 to 7 digits).
const FATOR_R = [
  // §5º-D and §5º-B XX: software, web pages, real estate, gyms, laboratories, imaging, prostheses.
  '3250706',
  '6201501',
  '6201502',
  '6202300',
  '6203100',
  '6204000',
  '6822600',
  '8591100',
  '8592901',
  '9313100',
  // §5º-B XVIII architecture; §5º-I VI to XII engineering, tests, research, design, advertising, translation,
  // agronomy, and other intellectual services: divisions 71 to 73, group 741, class 7490 (not diving).
  '71',
  '72',
  '73',
  '741',
  '7490',
  // §5º-I V, VII, IX, X: dispatchers, sales agents, audit, consulting, journalism.
  '5250801',
  '5250802',
  '461',
  '6391700',
  '6920602',
  '7020400',
  '9002701',
  // §5º-I II and §5º-M: veterinary, medicine, dentistry, physiotherapy, psychology, and similar.
  '7500100',
  '86',
];

// §5º-I XII covers only intellectual services: diving is not one.
const NOT_INTELLECTUAL = ['7490102'];

// §5º-C: works and landscaping, cleaning and security, and law firms pay the CPP outside the DAS.
const ANNEX_IV = ['412', '42', '43', '7410202', '8130300', '80111', '8012900', '812', '6911701'];

export type AnnexRule = 'III' | 'IV' | 'fator_r';

// The annex the main activity (the first CNAE) suggests; fator_r moves between Anexos III and V.
export function annexRule(cnaes: string[] | null): AnnexRule | null {
  const main = cnaes?.[0];
  if (!main) return null;
  if (ANNEX_IV.some((prefix) => main.startsWith(prefix))) return 'IV';
  if (NOT_INTELLECTUAL.includes(main)) return 'III';
  return FATOR_R.some((prefix) => main.startsWith(prefix)) ? 'fator_r' : 'III';
}
