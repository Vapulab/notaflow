import { codesInGroups, type ServiceCode } from './serviceCodes';

// NotaFlow's own table, not an official one: no national table links a CNAE to the LC 116 service list
// (the Anexo VIII links the list to the NBS; each municipality links its CNAEs). It only suggests: the
// full search always stays. Keys are CNAE prefixes (2 or 4 digits); values are LC 116 item groups.
const BY_PREFIX: Record<string, string[]> = {
  // Industry with service sides: printing, jewellery, repair and installation of machines.
  '1813': ['13', '24'],
  '3211': ['39', '40'],
  '33': ['14', '07'],
  // Utilities and construction.
  '37': ['07'],
  '38': ['07'],
  '39': ['07'],
  '41': ['07'],
  '42': ['07'],
  '43': ['07'],
  // Vehicle repair; sales agents.
  '4520': ['14'],
  '4543': ['14'],
  '461': ['10'],
  // Transport, storage, customs agents, couriers.
  '49': ['16'],
  '5211': ['11', '20'],
  '5212': ['11', '20'],
  '5231': ['20'],
  '5232': ['20'],
  '5239': ['20'],
  '5240': ['20'],
  '5250': ['33', '20'],
  '53': ['26'],
  // Lodging; publishing, film, sound, broadcasting.
  '55': ['09'],
  '58': ['13', '17'],
  '59': ['13'],
  '60': ['13', '17'],
  // IT and information services.
  '62': ['01'],
  '63': ['01', '17'],
  // Finance, insurance, real estate.
  '64': ['15', '10'],
  '65': ['18', '10'],
  '66': ['10', '15', '18'],
  '68': ['10', '17', '28'],
  // Professional services.
  '69': ['17'],
  '70': ['17'],
  '71': ['07', '31', '32', '30'],
  '72': ['02', '30'],
  '73': ['17', '23'],
  '7410': ['23', '32'],
  '7420': ['13'],
  '7490': ['17', '28'],
  '75': ['05'],
  // Rental, staffing, travel, security, building and office services.
  '77': ['03'],
  '78': ['17'],
  '79': ['09'],
  '80': ['11', '34'],
  '81': ['07'],
  '82': ['17', '12'],
  // Education, health, social work.
  '85': ['08'],
  '86': ['04'],
  '87': ['04', '27'],
  '88': ['27'],
  // Culture, sport, leisure.
  '90': ['12', '37', '40'],
  '91': ['29', '38', '12'],
  '92': ['19'],
  '93': ['12', '06', '37'],
  // Repairs and personal services.
  '95': ['14'],
  '9601': ['14'],
  '9602': ['06'],
  '9603': ['25'],
  '9609': ['06', '14'],
};

// The LC 116 item groups the company's CNAEs suggest, in the order of the CNAEs, each once.
export function suggestedGroups(cnaes: string[]): string[] {
  const groups: string[] = [];
  for (const cnae of cnaes) {
    const key = [4, 3, 2].map((n) => cnae.slice(0, n)).find((prefix) => BY_PREFIX[prefix]);
    for (const group of key ? (BY_PREFIX[key] ?? []) : []) {
      if (!groups.includes(group)) groups.push(group);
    }
  }
  return groups;
}

export function suggestedServiceCodes(cnaes: string[]): ServiceCode[] {
  return codesInGroups(suggestedGroups(cnaes));
}
