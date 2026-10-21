import type { Band6Iss } from '../api';
import { Field, Select } from '../ui';
import { isBand6Iss } from './simplesRates';

const OPTIONS: [Band6Iss, string][] = [
  ['under_sublimit', 'No DAS: a receita deste ano não passou de R$ 3,6 milhões'],
  [
    'over_sublimit',
    'No DAS: a receita deste ano passou de R$ 3,6 milhões, mas o ISS ainda não saiu',
  ],
  ['outside', 'Fora do DAS: o ISS é pago direto ao município'],
];

// LC 123, art. 20 §1º and §1º-A: the ISS leaves the DAS the month after the excess, or in January.
export function Band6IssField(props: {
  value: Band6Iss | null;
  onChange: (value: Band6Iss) => void;
}) {
  return (
    <Field
      label="ISS na faixa 6"
      hint="Quando a receita do ano passa de R$ 3,6 milhões, o ISS sai do DAS no mês seguinte, ou em janeiro se ela não passou de R$ 4,32 milhões. Na dúvida, pergunte ao seu contador."
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
