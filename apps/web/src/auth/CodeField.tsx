import { Field, Input } from '../ui';

// The 6 digits from the e-mail; the browser can fill it from the message.
export function CodeField(props: { value: string; onChange: (value: string) => void }) {
  return (
    <Field label="Código de 6 dígitos" hint="Enviado para o seu e-mail. Vale por 10 minutos.">
      <Input
        value={props.value}
        onChange={(event) => props.onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        autoComplete="one-time-code"
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        autoFocus
      />
    </Field>
  );
}
