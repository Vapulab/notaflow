import type { Band6Iss } from '../api';
import { Field, Select } from '../ui';
import { BAND6_ISS_HINT, BAND6_ISS_LABEL, BAND6_ISS_OPTIONS } from './band6IssText';
import { isBand6Iss } from './simplesRates';

// LC 123, art. 20 §1º-A: an excess up to 20% moves the ISS out of the DAS for all of the next year.
export function Band6IssField(props: {
  value: Band6Iss | null;
  onChange: (value: Band6Iss) => void;
}) {
  return (
    <Field label={BAND6_ISS_LABEL} hint={BAND6_ISS_HINT}>
      <Select
        value={props.value ?? ''}
        onChange={(e) => isBand6Iss(e.target.value) && props.onChange(e.target.value)}
      >
        <option value="" disabled>
          Escolha
        </option>
        {BAND6_ISS_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
    </Field>
  );
}
