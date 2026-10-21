import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  type Band6Iss,
  type CnpjDraft,
  type Emitter,
  type FiscalConfig,
  type InvoicePage,
  type SimplesAnnex,
  type OnboardingState,
} from '../../api';
import { AmountInput } from '../../components/AmountInput';
import { errorText } from '../../components/Layout';
import { Band6IssField } from '../../components/Band6IssField';
import {
  ANNEX_OPTIONS,
  asksBand6Iss,
  isSimplesAnnex,
  issOutsideDas,
} from '../../components/simplesRates';
import { useAsync } from '../../components/useAsync';
import { fileToBase64, formatCnpj, parseCents, parsePercent } from '../../format';
import { maskCnpj } from '../../masks';
import { navigate } from '../../router';
import {
  Alert,
  Button,
  CARD_CLASSES,
  Field,
  FORM_CLASSES,
  FileInput,
  Input,
  SECTION_TITLE_CLASSES,
  Select,
  Spinner,
} from '../../ui';

const SIMPLES_TEXT: Record<CnpjDraft['simplesNacional'], string> = {
  '1': 'Não optante',
  '2': 'MEI',
  '3': 'Optante (ME ou EPP)',
};

type OnDone = (state: OnboardingState) => void;
const accountUrl = (accountId: string) => `/api/accounts/${encodeURIComponent(accountId)}`;

function Panel(props: { title: string; children: ReactNode }) {
  return (
    <div className={`${CARD_CLASSES} ${FORM_CLASSES}`}>
      <h2 className={SECTION_TITLE_CLASSES}>{props.title}</h2>
      {props.children}
    </div>
  );
}

// One request at a time per step, with its error.
function useStepAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function StepError({ error }: { error: unknown }) {
  return error ? <Alert variant="error">{errorText(error)}</Alert> : null;
}

export function CompanyStep() {
  const [name, setName] = useState('');
  const { busy, error, run } = useStepAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const { accountId } = await api.post<{ accountId: string }>('/api/onboarding/account', {
        name: name.trim(),
      });
      // A full load: /api/me must now list the new account.
      navigate({ name: 'onboarding', accountId }, { replace: true });
    });
  };
  return (
    <Panel title="Nome da empresa">
      <StepError error={error} />
      <form className={FORM_CLASSES} onSubmit={submit}>
        <Field label="Nome da empresa" hint="Você pode mudar depois.">
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </Field>
        <div>
          <Button type="submit" variant="primary" disabled={busy}>
            Continuar
          </Button>
        </div>
      </form>
    </Panel>
  );
}

// prefix is .../onboarding for the first emitter, or .../emitters/new for another one.
export function CardStep(props: { prefix: string; onDone: OnDone }) {
  const [file, setFile] = useState<File | null>(null);
  const [typing, setTyping] = useState(false);
  const [cnpj, setCnpj] = useState('');
  const { busy, error, run } = useStepAction();
  const finish = (answer: { draft: CnpjDraft; municipalityName: string | null }) =>
    props.onDone({
      step: 'certificate',
      draft: answer.draft,
      municipalityName: answer.municipalityName,
    });

  const sendCard = (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    void run(async () => {
      // The server refuses it too; this saves uploading a large file for nothing.
      if (file.size > 2 * 1024 * 1024) throw new ApiError(413, 'card_too_large');
      finish(
        await api.post(`${props.prefix}/card`, {
          pdfBase64: await fileToBase64(file),
          fileName: file.name,
        }),
      );
    });
  };
  const sendCnpj = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => finish(await api.post(`${props.prefix}/cnpj`, { cnpj })));
  };

  return (
    <Panel title="Cartão CNPJ">
      <p className="text-sm text-muted">
        Baixe o comprovante de inscrição no site da Receita Federal e envie o PDF. Conferimos os
        dados na consulta pública do CNPJ.
      </p>
      <StepError error={error} />
      {typing ? (
        <form className={FORM_CLASSES} onSubmit={sendCnpj}>
          <Field label="CNPJ">
            <Input
              value={cnpj}
              onChange={(e) => setCnpj(maskCnpj(e.target.value))}
              autoCapitalize="characters"
              required
              maxLength={18}
            />
          </Field>
          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              Consultar CNPJ
            </Button>
          </div>
        </form>
      ) : (
        <form className={FORM_CLASSES} onSubmit={sendCard}>
          <Field label="Cartão CNPJ (PDF)" hint="Até 2 MB.">
            <FileInput
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy || !file}>
              Enviar cartão
            </Button>
            {Boolean(error) && (
              <Button variant="secondary" onClick={() => setTyping(true)}>
                Digitar o CNPJ
              </Button>
            )}
          </div>
        </form>
      )}
      {busy && <Spinner label="Lendo o cartão e consultando o CNPJ" />}
    </Panel>
  );
}

export function CertificateStep(props: {
  prefix: string;
  state: OnboardingState;
  onDone: OnDone;
  // Another emitter has no step to undo: "Trocar cartão" only goes back on screen.
  onBack?: () => void;
}) {
  const { draft, municipalityName } = props.state;
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [registration, setRegistration] = useState('');
  const [simplesRegime, setSimplesRegime] = useState<'1' | '2' | '3'>('1');
  const [specialRegime, setSpecialRegime] = useState('0');
  const [dpsSeries, setDpsSeries] = useState('900');
  const { busy, error, run } = useStepAction();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    void run(async () => {
      await api.post(`${props.prefix}/certificate`, {
        pfxBase64: await fileToBase64(file),
        password,
        ...(registration.trim() ? { municipalRegistration: registration.trim() } : {}),
        advanced: {
          ...(draft?.simplesNacional === '3' ? { simplesRegime } : {}),
          specialRegime,
          dpsSeries,
        },
      });
      props.onDone({ ...props.state, step: 'fiscal' });
    });
  };
  const backToCard = () =>
    run(async () => {
      if (props.onBack) return props.onBack();
      await api.post(`${props.prefix}/back-to-card`, {});
      props.onDone({ step: 'card', draft: null, municipalityName: null });
    });

  return (
    <div className="flex flex-col gap-6">
      {draft && (
        <section aria-label="Confira os dados" className={`${CARD_CLASSES} flex flex-col gap-2`}>
          <h2 className={SECTION_TITLE_CLASSES}>Confira os dados</h2>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Razão social</dt>
            <dd className="break-words">{draft.legalName}</dd>
            <dt className="text-muted">CNPJ</dt>
            <dd>{formatCnpj(draft.cnpj)}</dd>
            <dt className="text-muted">Município</dt>
            <dd>{municipalityName ? `${municipalityName} - ${draft.uf}` : draft.uf}</dd>
            <dt className="text-muted">Simples Nacional</dt>
            <dd>{SIMPLES_TEXT[draft.simplesNacional]}</dd>
          </dl>
          <div>
            <Button variant="secondary" size="sm" disabled={busy} onClick={backToCard}>
              Trocar cartão
            </Button>
          </div>
        </section>
      )}
      <Panel title="Certificado digital">
        <StepError error={error} />
        <form className={FORM_CLASSES} onSubmit={submit}>
          <Field label="Certificado A1 (.pfx)">
            <FileInput
              accept=".pfx,.p12,application/x-pkcs12"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <Field label="Senha do certificado">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              required
            />
          </Field>
          <Field label="Inscrição municipal (opcional)">
            <Input
              value={registration}
              onChange={(e) => setRegistration(e.target.value)}
              maxLength={15}
            />
          </Field>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Opções avançadas</summary>
            <div className="mt-3 flex flex-col gap-4">
              {draft?.simplesNacional === '3' && (
                <Field label="Regime de apuração do Simples">
                  <Select
                    value={simplesRegime}
                    onChange={(e) => setSimplesRegime(e.target.value as '1' | '2' | '3')}
                  >
                    <option value="1">Tributos federais e municipais pelo Simples</option>
                    <option value="2">Federais pelo Simples, ISS pela NFS-e</option>
                    <option value="3">Federais e municipais pela NFS-e</option>
                  </Select>
                </Field>
              )}
              <Field label="Regime especial de tributação">
                <Select value={specialRegime} onChange={(e) => setSpecialRegime(e.target.value)}>
                  <option value="0">Nenhum</option>
                  <option value="1">Ato cooperado</option>
                  <option value="2">Estimativa</option>
                  <option value="3">Microempresa municipal</option>
                  <option value="4">Notário ou registrador</option>
                  <option value="5">Profissional autônomo</option>
                  <option value="6">Sociedade de profissionais</option>
                </Select>
              </Field>
              <Field label="Série da DPS">
                <Input
                  value={dpsSeries}
                  onChange={(e) => setDpsSeries(e.target.value)}
                  inputMode="numeric"
                  pattern="[0-9]{1,5}"
                />
              </Field>
            </div>
          </details>
          <div>
            <Button type="submit" variant="primary" disabled={busy || !file}>
              Enviar certificado
            </Button>
          </div>
          {busy && <Spinner label="Testando o certificado no sistema nacional" />}
        </form>
      </Panel>
    </div>
  );
}

// The Simples Nacional bands, by gross revenue of the last 12 months (LC 123/2006), in cents.
const BAND_LIMITS = [18_000_000, 36_000_000, 72_000_000, 180_000_000, 360_000_000, 480_000_000];

function bandOf(revenueCents: number): number | null {
  const index = BAND_LIMITS.findIndex((limit) => revenueCents <= limit);
  return index === -1 ? null : index + 1;
}

function formatCnae(cnae: string): string {
  return /^\d{7}$/.test(cnae) ? `${cnae.slice(0, 4)}-${cnae.slice(4, 5)}/${cnae.slice(5)}` : cnae;
}

export function FiscalStep(props: { accountId: string; state: OnboardingState; onDone: OnDone }) {
  const base = accountUrl(props.accountId);
  const { draft } = props.state;
  const emitters = useAsync(() => api.get<Emitter[]>(`${base}/emitters`), [base]);
  const emitter = emitters.data?.[0];
  const fiscal = useAsync(
    () =>
      emitter
        ? api.get<FiscalConfig>(`${base}/emitters/${encodeURIComponent(emitter.id)}/fiscal`)
        : Promise.resolve(null),
    [base, emitter?.id],
  );
  const rule = fiscal.data?.annexRule ?? null;
  // Without a CNAE the payroll question stays.
  const asksPayroll = rule === 'fator_r' || rule === null;
  const [revenue, setRevenue] = useState('');
  const [payroll, setPayroll] = useState<'yes' | 'no' | null>(null);
  const [annexChoice, setAnnexChoice] = useState<SimplesAnnex | null>(null);
  const [iss, setIss] = useState('');
  const [band6Iss, setBand6Iss] = useState<Band6Iss | null>(null);
  const [regime, setRegime] = useState<'inside_das' | 'regular'>('inside_das');
  const { busy, error, run } = useStepAction();

  const revenueCents = parseCents(revenue);
  const band = revenueCents === null ? null : bandOf(revenueCents);
  const overLimit = revenueCents !== null && band === null;
  // Fator R: a payroll of 28% or more of the revenue puts these services in Anexo III.
  const annex =
    annexChoice ??
    (rule === 'IV' || rule === 'III'
      ? rule
      : payroll === 'yes'
        ? 'III'
        : payroll === 'no'
          ? 'V'
          : null);
  const issRate = parsePercent(iss);
  const asksBand6 = asksBand6Iss(annex, band);
  const typedIss = issOutsideDas(annex, band, band6Iss);
  const ready =
    !!emitter &&
    band !== null &&
    annex !== null &&
    (!asksBand6 || band6Iss !== null) &&
    (!typedIss || (issRate !== null && issRate <= 500));

  const finish = async () => {
    await api.post(`${base}/onboarding/fiscal-done`, {});
    props.onDone({ step: 'sync', draft: null, municipalityName: null });
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || !emitter || revenueCents === null || annex === null) return;
    void run(async () => {
      await api.put(`${base}/emitters/${encodeURIComponent(emitter.id)}/fiscal`, {
        simplesAnnex: annex,
        // The server derives the band and the rates of each invoice from the revenue.
        simplesRbt12Cents: revenueCents,
        ...(asksBand6 && band6Iss ? { simplesBand6Iss: band6Iss } : {}),
        ...(typedIss && issRate !== null ? { issRate } : {}),
        ibscbsRegime: regime,
      });
      await finish();
    });
  };

  return (
    <Panel title="Configuração fiscal">
      <p className="text-sm text-muted">
        Com estes dados, a nota nova já sai com as alíquotas do Simples. Você pode mudar depois na
        página do emitente.
      </p>
      {draft?.cnae && (
        <p className="text-sm">
          <span className="text-muted">Atividade principal: </span>
          {draft.cnaeDescription
            ? `${formatCnae(draft.cnae)} · ${draft.cnaeDescription}`
            : formatCnae(draft.cnae)}
        </p>
      )}
      <StepError error={error} />
      <form className={FORM_CLASSES} onSubmit={save}>
        <Field
          label="Receita bruta dos últimos 12 meses (R$)"
          hint="Empresa com menos de 12 meses: a média mensal vezes 12."
        >
          <AmountInput unit="R$" value={revenue} onValueChange={setRevenue} />
        </Field>
        {band !== null && <p className="text-sm text-fg">Faixa {band} do Simples Nacional</p>}
        {asksBand6 && <Band6IssField value={band6Iss} onChange={setBand6Iss} />}
        {typedIss && (
          <Field
            label="Alíquota de ISS (%)"
            hint="Com o ISS fora do DAS (Anexos I e II, ou na faixa 6 depois do sublimite): a alíquota do município, usada quando o cliente retém o ISS."
          >
            <AmountInput unit="%" value={iss} onValueChange={setIss} />
          </Field>
        )}
        {overLimit && (
          <Alert variant="warning">
            Acima de R$ 4.800.000,00 a empresa sai do Simples Nacional.
          </Alert>
        )}
        {!asksPayroll && (
          <p className="text-sm text-fg">
            {rule === 'IV'
              ? 'A atividade principal (obras, limpeza, vigilância ou advocacia) costuma ser do Anexo IV: a contribuição previdenciária (CPP) é paga fora do DAS.'
              : 'A atividade principal não depende do fator R: Anexo III do Simples Nacional.'}{' '}
            Se o seu contador indicar outro anexo, mude em Opções avançadas.
          </p>
        )}
        {asksPayroll && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-fg">
              A folha de salários dos últimos 12 meses, com o pró-labore, é de 28% ou mais da
              receita?
            </legend>
            {(
              [
                ['yes', 'Sim, 28% ou mais'],
                ['no', 'Não, menos de 28%'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="radio"
                  name="payroll"
                  checked={payroll === value}
                  onChange={() => {
                    setPayroll(value);
                    setAnnexChoice(null);
                  }}
                />
                {label}
              </label>
            ))}
            <p className="text-xs text-muted">
              É o fator R: decide entre o Anexo III e o Anexo V. Se a sua atividade é sempre do
              Anexo III, escolha o anexo em Opções avançadas; na dúvida, pergunte ao seu contador.
            </p>
          </fieldset>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Opções avançadas</summary>
          <div className="mt-3 flex flex-col gap-4">
            <Field label="Anexo do Simples">
              <Select
                value={annex ?? ''}
                onChange={(e) => isSimplesAnnex(e.target.value) && setAnnexChoice(e.target.value)}
              >
                <option value="" disabled>
                  Responda a pergunta da folha
                </option>
                {ANNEX_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Regime do IBS/CBS">
              <Select
                value={regime}
                onChange={(e) => setRegime(e.target.value === 'regular' ? 'regular' : 'inside_das')}
              >
                <option value="inside_das">Dentro do DAS</option>
                <option value="regular">Regular (fora do DAS)</option>
              </Select>
            </Field>
          </div>
        </details>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={busy || !ready}>
            Salvar e continuar
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => run(finish)}>
            Fazer depois
          </Button>
        </div>
      </form>
    </Panel>
  );
}

export function SyncStep(props: { accountId: string }) {
  const base = accountUrl(props.accountId);
  const [total, setTotal] = useState<number | null>(null);
  const { busy, error, run } = useStepAction();
  useEffect(() => {
    let live = true;
    const read = () =>
      api.get<InvoicePage>(`${base}/invoices?limit=1`).then(
        (page) => live && setTotal(page.total),
        () => undefined,
      );
    void read();
    const timer = window.setInterval(read, 3000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [base]);
  const finish = () =>
    run(async () => {
      await api.post(`${base}/onboarding/finish`, {});
      navigate({ name: 'home' }, { replace: true });
    });
  return (
    <Panel title="Sincronização">
      <p className="text-sm text-muted">
        Estamos trazendo as notas que a empresa já emitiu no sistema nacional. Você pode ir para o
        painel agora: a importação continua sozinha.
      </p>
      <p className="font-display text-2xl text-fg" aria-live="polite">
        {total === null ? 'Contando…' : `${total} notas importadas até agora`}
      </p>
      <StepError error={error} />
      <div>
        <Button variant="primary" disabled={busy} onClick={finish}>
          Ir para o painel
        </Button>
      </div>
    </Panel>
  );
}
