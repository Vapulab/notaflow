// NotaFlow's own table, not an official one: LC 123, art. 18, §5º-I and §5º-M name the fator R activities
// only in words (Res. CGSN 140, art. 25, §1º, V), and no CGSN annex links them to CNAEs. It only suggests.
// Keys are CNAE prefixes (2 to 7 digits).
const PREFIXES = [
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

// Whether the main activity (the first CNAE) moves between Anexos III and V by the fator R.
export function fatorRApplies(cnaes: string[] | null): boolean | null {
  const main = cnaes?.[0];
  if (!main) return null;
  return PREFIXES.some((prefix) => main.startsWith(prefix));
}
