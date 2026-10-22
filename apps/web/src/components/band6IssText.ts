import type { Band6Iss } from '../api';

// Shared with the static guide calculator, which has no React.
export const BAND6_ISS_LABEL = 'ISS na faixa 6';

export const BAND6_ISS_HINT =
  'No DAS quer dizer que o ISS vai junto na guia do Simples; fora do DAS, ele é pago direto à prefeitura. Quando a receita do ano passa de R$ 3,6 milhões, o ISS sai do DAS no mês seguinte, ou em janeiro se ela não passou de R$ 4,32 milhões. Na dúvida, pergunte ao seu contador.';

export const BAND6_ISS_OPTIONS: [Band6Iss, string][] = [
  [
    'under_sublimit',
    'No DAS: nem a receita deste ano nem a do ano passado passaram de R$ 3,6 milhões',
  ],
  [
    'over_sublimit',
    'No DAS: a receita deste ano passou de R$ 3,6 milhões, e o ISS só sai do DAS no mês seguinte ou em janeiro',
  ],
  [
    'outside',
    'Fora do DAS: a receita do ano passado passou de R$ 3,6 milhões, ou o ISS já saiu do DAS neste ano',
  ],
];
