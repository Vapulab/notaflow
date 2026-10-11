import { useState } from 'react';
import {
  api,
  type Emitter,
  type Me,
  type OnboardingState,
  type SyncResult,
  type SyncState,
} from '../api';
import { CertificateWarning } from '../components/CertificateWarning';
import { EnvironmentBadge } from '../components/EnvironmentBadge';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { fileToBase64, formatDate } from '../format';
import { routeHref } from '../router';
import { Alert, Button, buttonClasses, Card, Link, SECTION_TITLE_CLASSES } from '../ui';
import { CardStep, CertificateStep } from './onboarding/steps';

type Act = (action: () => Promise<string>) => Promise<void>;

export function EmittersPage({ accountId }: { accountId: string }) {
  const base = `/api/accounts/${encodeURIComponent(accountId)}`;
  const me = useAsync(() => api.get<Me>('/api/me'), []);
  const emitters = useAsync(() => api.get<Emitter[]>(`${base}/emitters`), [base]);
  const [message, setMessage] = useState<string | null>(null);
  const account = me.data?.accounts.find((a) => a.id === accountId);
  const isOwner = account?.role === 'owner';
  // An unfinished account adds its first emitter through onboarding.
  const canAddEmitter = isOwner && account?.onboardingStep === 'done';
  // Produção restrita is a platform-admin tool; every account works in production.
  const isAdmin = me.data?.platformRole === 'admin';

  const act: Act = async (action) => {
    setMessage(null);
    try {
      setMessage(await action());
      emitters.reload();
    } catch (error) {
      setMessage(errorText(error));
    }
  };

  return (
    <Layout title="Emitentes" accountId={accountId}>
      {message && <Alert variant="info">{message}</Alert>}
      {emitters.error && <Alert variant="error">{errorText(emitters.error)}</Alert>}
      {emitters.data?.map((emitter) => (
        <EmitterCard
          key={emitter.id}
          base={base}
          accountId={accountId}
          emitter={emitter}
          isOwner={isOwner}
          isAdmin={isAdmin}
          act={act}
        />
      ))}
      {canAddEmitter && (
        <AddEmitter
          prefix={`${base}/emitters/new`}
          onCreated={() =>
            act(async () => 'Emitente cadastrado. A primeira sincronização começou.')
          }
        />
      )}
    </Layout>
  );
}

function EmitterCard(props: {
  accountId: string;
  base: string;
  emitter: Emitter;
  isOwner: boolean;
  isAdmin: boolean;
  act: Act;
}) {
  const { accountId, base, emitter, isOwner, isAdmin, act } = props;
  const url = `${base}/emitters/${encodeURIComponent(emitter.id)}`;
  const sync = useAsync(() => api.get<SyncState>(`${url}/sync`), [url]);

  async function replaceCertificate(file: File) {
    const password = window.prompt('Senha do novo certificado') ?? '';
    await act(async () => {
      await api.post(`${url}/certificate`, { pfxBase64: await fileToBase64(file), password });
      return 'Certificado trocado.';
    });
  }

  function switchEnvironment() {
    const target = emitter.environment === 'producao' ? 'producao_restrita' : 'producao';
    const confirm =
      target === 'producao'
        ? (window.prompt('Para emitir notas reais, digite producao') ?? '')
        : 'producao_restrita';
    if (!confirm) return;
    void act(async () => {
      await api.post(`${url}/environment`, { environment: target, confirm });
      return target === 'producao'
        ? 'Ambiente trocado para PRODUÇÃO.'
        : 'Ambiente trocado para produção restrita.';
    });
  }

  function syncNow() {
    void act(async () => {
      const result = await api.post<SyncResult>(`${url}/sync`, {});
      sync.reload();
      return result.error
        ? `Sincronização parou: ${result.error}`
        : `${result.invoices} notas e ${result.events} eventos sincronizados.`;
    });
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={SECTION_TITLE_CLASSES + ' mb-0'}>
          {emitter.companyName}{' '}
          <small className="text-sm font-normal text-muted">{emitter.cnpj}</small>
        </h2>
        <EnvironmentBadge environment={emitter.environment} />
      </div>
      <CertificateWarning certificate={emitter.certificate} />
      {sync.data && (
        <p className="text-sm text-muted">
          Última sincronização: {formatDate(sync.data.lastSuccessAt) || 'nunca'}
          {sync.data.lastError && (
            <span className="text-danger"> (erro: {sync.data.lastError})</span>
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={syncNow}>
          Sincronizar agora
        </Button>
        <Link
          className={buttonClasses({ variant: 'secondary' })}
          href={routeHref({ name: 'emitter', accountId, emitterId: emitter.id })}
        >
          Configuração fiscal e serviços
        </Link>
        {isOwner && (
          <>
            <label className={`${buttonClasses({ variant: 'secondary' })} cursor-pointer`}>
              Trocar certificado
              <input
                type="file"
                accept=".pfx,.p12"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void replaceCertificate(file);
                }}
              />
            </label>
          </>
        )}
        {isAdmin && (
          <Button
            variant={emitter.environment === 'producao' ? 'secondary' : 'danger'}
            onClick={switchEnvironment}
          >
            {emitter.environment === 'producao'
              ? 'Voltar para produção restrita'
              : 'Passar para PRODUÇÃO'}
          </Button>
        )}
      </div>
    </Card>
  );
}

// Another company of the account: the card, then the certificate, as in onboarding.
function AddEmitter(props: { prefix: string; onCreated: () => void }) {
  const [state, setState] = useState<OnboardingState | 'closed' | 'card'>('closed');
  if (state === 'closed') {
    return (
      <div>
        <Button variant="primary" onClick={() => setState('card')}>
          Adicionar emitente
        </Button>
      </div>
    );
  }
  if (state === 'card') return <CardStep prefix={props.prefix} onDone={setState} />;
  return (
    <CertificateStep
      prefix={props.prefix}
      state={state}
      onBack={() => setState('card')}
      onDone={() => {
        setState('closed');
        props.onCreated();
      }}
    />
  );
}
