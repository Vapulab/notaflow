import { useEffect, useState } from 'react';
import { api, type OnboardingState, type OnboardingStep } from '../../api';
import { errorText, Layout } from '../../components/Layout';
import { useAsync } from '../../components/useAsync';
import { Alert, Badge, Spinner } from '../../ui';
import { CardStep, CertificateStep, CompanyStep, FiscalStep, SyncStep } from './steps';

const TIMELINE: { key: string; title: string; line: string }[] = [
  { key: 'account', title: 'Criar conta', line: 'Seu acesso ao NotaFlow.' },
  {
    key: 'company',
    title: 'Nome da empresa',
    line: 'Como a conta aparece para você e sua equipe.',
  },
  {
    key: 'card',
    title: 'Cartão CNPJ',
    line: 'O comprovante de inscrição, em PDF, do site da Receita.',
  },
  {
    key: 'certificate',
    title: 'Certificado digital',
    line: 'O certificado A1 (.pfx) da empresa e a senha dele.',
  },
  {
    key: 'fiscal',
    title: 'Configuração fiscal',
    line: 'Anexo, faixa e ISS do Simples. Pode ficar para depois.',
  },
  {
    key: 'sync',
    title: 'Sincronização',
    line: 'Trazemos as notas já emitidas no sistema nacional.',
  },
  { key: 'tour', title: 'Tour', line: 'Um passeio rápido pelo painel.' },
];

// The timeline position of a stored step; "done" leaves only the tour, which runs on the dashboard.
function positionOf(step: OnboardingStep | 'company'): number {
  const key = step === 'done' ? 'tour' : step;
  return TIMELINE.findIndex((item) => item.key === key);
}

function Timeline({ step }: { step: OnboardingStep | 'company' }) {
  const current = positionOf(step);
  return (
    <ol aria-label="Etapas do cadastro" className="flex flex-col gap-4">
      {TIMELINE.map((item, index) => {
        const state = index < current ? 'feito' : index === current ? 'atual' : 'a fazer';
        return (
          <li
            key={item.key}
            {...(state === 'atual' ? { 'aria-current': 'step' as const } : {})}
            className={`border-l-2 pl-4 ${state === 'atual' ? 'border-primary' : 'border-border'}`}
          >
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-fg">{item.title}</h3>
              <Badge
                variant={state === 'feito' ? 'success' : state === 'atual' ? 'primary' : 'neutral'}
                data-testid="state"
              >
                {state}
              </Badge>
            </div>
            <p className="text-sm text-muted">{item.line}</p>
          </li>
        );
      })}
    </ol>
  );
}

export function OnboardingPage(props: { accountId?: string }) {
  const { accountId } = props;
  const loaded = useAsync(
    () =>
      accountId
        ? api.get<OnboardingState>(`/api/accounts/${encodeURIComponent(accountId)}/onboarding`)
        : Promise.resolve<OnboardingState | null>(null),
    [accountId],
  );
  const [state, setState] = useState<OnboardingState | null>(null);
  useEffect(() => setState(loaded.data ?? null), [loaded.data]);

  const step: OnboardingStep | 'company' = accountId ? (state?.step ?? 'card') : 'company';
  let panel;
  if (!accountId) panel = <CompanyStep />;
  else if (loaded.error) panel = <Alert variant="error">{errorText(loaded.error)}</Alert>;
  else if (!state) panel = <Spinner />;
  else if (state.step === 'card') panel = <CardStep accountId={accountId} onDone={setState} />;
  else if (state.step === 'certificate') {
    panel = <CertificateStep accountId={accountId} state={state} onDone={setState} />;
  } else if (state.step === 'fiscal') {
    panel = <FiscalStep accountId={accountId} onDone={setState} />;
  } else panel = <SyncStep accountId={accountId} />;

  return (
    <Layout title="Comece por aqui">
      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        {/* Until the step is known, a timeline would show the wrong one. */}
        {accountId && !state ? <span /> : <Timeline step={step} />}
        <section aria-label="Etapa atual" className="min-w-0">
          {panel}
        </section>
      </div>
    </Layout>
  );
}
