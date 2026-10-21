import { type FormEvent, useState } from 'react';
import { api, type FiscalConfig, type SimplesAnnex } from '../api';
import { AmountInput } from '../components/AmountInput';
import { errorText } from '../components/Layout';
import {
  ANNEX_OPTIONS,
  isSimplesAnnex,
  RBT12_LABEL,
  ratesLine,
  revenueIsStale,
  useSimplesRates,
} from '../components/simplesRates';
import { centsInput, formatDate, parseCents, parsePercent, percentInput } from '../format';
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

export function FiscalConfigForm(props: { url: string; config: FiscalConfig; canEdit: boolean }) {
  const { config, canEdit } = props;
  const ratesUrl = props.url.replace(/\/emitters\/[^/]+\/fiscal$/, '/simples-rates');
  const [annex, setAnnex] = useState<SimplesAnnex>(config.simplesAnnex ?? 'III');
  const [revenue, setRevenue] = useState(
    config.simplesRbt12Cents === null ? '' : centsInput(config.simplesRbt12Cents),
  );
  const [iss, setIss] = useState(config.issRate === null ? '' : percentInput(config.issRate));
  const [regime, setRegime] = useState(config.ibscbsRegime);
  const [from, setFrom] = useState(config.ibscbsRegimeFrom ?? '');
  const [message, setMessage] = useState<{ variant: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [informedAt, setInformedAt] = useState(config.simplesRbt12At);
  const issRate = parsePercent(iss);
  const rbt12Cents = parseCents(revenue);
  const unchanged = annex === config.simplesAnnex && rbt12Cents === config.simplesRbt12Cents;
  const preview = useSimplesRates(ratesUrl, annex, unchanged ? null : rbt12Cents);
  const rates =
    unchanged && config.rates && config.simplesBand
      ? { band: config.simplesBand, ...config.rates }
      : preview.rates;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (rbt12Cents === null) {
      setMessage({ variant: 'error', text: 'Informe a receita bruta dos últimos 12 meses.' });
      return;
    }
    // Only band 6 has no ISS share: its ISS goes outside the DAS, at the municipal rate.
    const typedIss = rates?.iss === null;
    if (typedIss && (issRate === null || issRate > 500)) {
      setMessage({
        variant: 'error',
        text: 'Informe a alíquota de ISS até 5,00%, por exemplo 2,00.',
      });
      return;
    }
    setBusy(true);
    try {
      const saved = await api.put<FiscalConfig>(props.url, {
        simplesAnnex: annex,
        simplesRbt12Cents: rbt12Cents,
        ...(typedIss && issRate !== null ? { issRate } : {}),
        ibscbsRegime: regime,
        ...(from ? { ibscbsRegimeFrom: from } : {}),
      });
      setInformedAt(saved?.simplesRbt12At ?? new Date().toISOString());
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
      {!informedAt && (
        <Alert variant="warning">
          Sem esta configuração não é possível emitir uma nota sem modelo.
        </Alert>
      )}
      {revenueIsStale(informedAt) && (
        <Alert variant="warning">
          Atualize a receita dos últimos 12 meses: a alíquota do Simples de cada mês depende dela.
        </Alert>
      )}
      {annex === 'V' && config.fatorR === false && (
        <Alert variant="warning">
          A atividade principal não depende do fator R: em geral ela é do Anexo III. Confira o anexo
          com o seu contador.
        </Alert>
      )}
      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Anexo do Simples">
            <Select
              value={annex}
              onChange={(e) => isSimplesAnnex(e.target.value) && setAnnex(e.target.value)}
            >
              {ANNEX_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={RBT12_LABEL}
            hint={
              informedAt
                ? `Informada em ${formatDate(informedAt)}. Atualize todo mês, antes da primeira nota.`
                : 'A soma das receitas dos 12 meses antes do mês da nota.'
            }
          >
            <AmountInput unit="R$" value={revenue} onValueChange={setRevenue} />
          </Field>
          {rates?.iss === null && (
            <Field
              label="Alíquota de ISS (%)"
              hint="Na faixa 6 o ISS sai do DAS: a alíquota do município, usada quando o cliente retém o ISS."
            >
              <AmountInput unit="%" value={iss} onValueChange={setIss} />
            </Field>
          )}
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
      {rates && <p className="text-sm text-fg">{ratesLine(rates)}</p>}
      {Boolean(preview.error) && <Alert variant="warning">{errorText(preview.error)}</Alert>}
      {message && <Alert variant={message.variant}>{message.text}</Alert>}
      <div>
        <Button type="submit" variant="primary" disabled={!canEdit || busy}>
          Salvar configuração
        </Button>
      </div>
    </form>
  );
}
