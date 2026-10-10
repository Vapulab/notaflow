import { type FormEvent, useState } from 'react';
import { api, type FiscalConfig } from '../api';
import { errorText } from '../components/Layout';
import { parsePercent, percentInput } from '../format';
import {
  Alert,
  Button,
  CARD_CLASSES,
  Field,
  FORM_CLASSES,
  Input,
  SECTION_TITLE_CLASSES,
  Select,
} from '../ui';

export const OWNER_ONLY_TEXT = 'Só o dono da conta altera a configuração fiscal e os serviços.';

export function bandLabel(band: number, percent: number): string {
  return `Faixa ${band} – ${percentInput(percent)}%`;
}

export function FiscalConfigForm(props: { url: string; config: FiscalConfig; canEdit: boolean }) {
  const { config, canEdit } = props;
  const [annex, setAnnex] = useState<'III' | 'V'>(config.simplesAnnex ?? 'III');
  const [band, setBand] = useState(String(config.simplesBand ?? 1));
  const [iss, setIss] = useState(config.issRate === null ? '' : percentInput(config.issRate));
  const [regime, setRegime] = useState(config.ibscbsRegime);
  const [from, setFrom] = useState(config.ibscbsRegimeFrom ?? '');
  const [message, setMessage] = useState<{ variant: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(config.simplesPercent !== null);
  const issRate = parsePercent(iss);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (issRate === null) {
      setMessage({ variant: 'error', text: 'Informe a alíquota de ISS, por exemplo 2,00.' });
      return;
    }
    setBusy(true);
    try {
      await api.put(props.url, {
        simplesAnnex: annex,
        simplesBand: Number(band),
        issRate,
        ibscbsRegime: regime,
        ...(from ? { ibscbsRegimeFrom: from } : {}),
      });
      setConfigured(true);
      setMessage({ variant: 'info', text: 'Configuração salva.' });
    } catch (error) {
      setMessage({ variant: 'error', text: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className={`${CARD_CLASSES} ${FORM_CLASSES}`}>
      <h2 className={SECTION_TITLE_CLASSES}>Configuração fiscal</h2>
      {!configured && (
        <Alert variant="warning">
          Sem esta configuração não é possível emitir uma nota sem modelo.
        </Alert>
      )}
      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Anexo do Simples">
            <Select value={annex} onChange={(e) => setAnnex(e.target.value as 'III' | 'V')}>
              <option value="III">Anexo III</option>
              <option value="V">Anexo V</option>
            </Select>
          </Field>
          <Field label="Faixa">
            <Select value={band} onChange={(e) => setBand(e.target.value)}>
              {config.bands[annex].map((percent, index) => (
                <option key={index + 1} value={String(index + 1)}>
                  {bandLabel(index + 1, percent)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Alíquota de ISS (%)" hint="Usada quando o cliente retém o ISS.">
            <Input inputMode="decimal" value={iss} onChange={(e) => setIss(e.target.value)} />
          </Field>
          <Field label="Regime do IBS/CBS">
            <Select
              value={regime}
              onChange={(e) => setRegime(e.target.value as FiscalConfig['ibscbsRegime'])}
            >
              <option value="inside_das">Dentro do DAS</option>
              <option value="regular">Regular (fora do DAS)</option>
            </Select>
          </Field>
          <Field label="Desde">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
        </div>
      </fieldset>
      {message && <Alert variant={message.variant}>{message.text}</Alert>}
      <div>
        <Button type="submit" variant="primary" disabled={!canEdit || busy}>
          Salvar configuração
        </Button>
      </div>
    </form>
  );
}
