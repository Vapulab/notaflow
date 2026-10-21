import type { Band6Iss } from '../api';
import { Field, Select } from '../ui';
import { isBand6Iss } from './simplesRates';

const OPTIONS: [Band6Iss, string][] = [
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

// LC 123, art. 20 §1º-A: an excess up to 20% moves the ISS out of the DAS for all of the next year.
export function Band6IssField(props: {
  value: Band6Iss | null;
  onChange: (value: Band6Iss) => void;
}) {
  return (
    <Field
      label="ISS na faixa 6"
      hint="No DAS quer dizer que o ISS vai junto na guia do Simples; fora do DAS, ele é pago direto à prefeitura. Quando a receita do ano passa de R$ 3,6 milhões, o ISS sai do DAS no mês seguinte, ou em janeiro se ela não passou de R$ 4,32 milhões. Na dúvida, pergunte ao seu contador."
    >
      <Select
        value={props.value ?? ''}
        onChange={(e) => isBand6Iss(e.target.value) && props.onChange(e.target.value)}
      >
        <option value="" disabled>
          Escolha
        </option>
        {OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
    </Field>
  );
}
