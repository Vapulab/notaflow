import { useEffect } from 'react';
import { api, type Me } from '../api';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { navigate, type Route, routeHref } from '../router';
import { startTour } from '../tour/tour';
import { Alert, Badge, CARD_CLASSES, SECTION_TITLE_CLASSES, Spinner } from '../ui';

interface Option {
  route: Route;
  title: string;
  text: string;
  tour?: string;
}

function optionsFor(account: Me['accounts'][number]): Option[] {
  const accountId = account.id;
  return [
    {
      route: { name: 'invoices', accountId },
      title: 'Notas',
      tour: 'notas',
      text: 'Veja, filtre e baixe as notas, e use uma delas para emitir outra.',
    },
    {
      route: { name: 'newInvoice', accountId },
      title: 'Nova nota',
      tour: 'nova-nota',
      text: 'Emita uma nota para um cliente, sem modelo.',
    },
    {
      route: { name: 'emitters', accountId },
      title: 'Emitentes',
      tour: 'emitentes',
      text: 'Empresas que emitem, certificado digital e sincronização.',
    },
    {
      route: { name: 'customers', accountId },
      title: 'Clientes',
      tour: 'clientes',
      text: 'Os tomadores das notas e os dados de cada um.',
    },
    ...(account.role === 'owner'
      ? [
          {
            route: { name: 'members', accountId } as Route,
            title: 'Membros',
            text: 'Quem acessa esta conta; convide outras pessoas.',
          },
        ]
      : []),
  ];
}

// A whole card is the link, so the title and the line below both name it.
function OptionCard({ option }: { option: Option }) {
  return (
    <a
      href={routeHref(option.route)}
      {...(option.tour ? { 'data-tour': option.tour } : {})}
      className={`${CARD_CLASSES} flex flex-col gap-1 transition-colors hover:border-primary/60 hover:bg-muted/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}
    >
      <span className="font-display text-lg font-semibold text-fg">{option.title}</span>
      <span className="text-sm text-muted">{option.text}</span>
    </a>
  );
}

// Where a user without a finished account belongs: onboarding, unless there is a choice to make.
function onboardingTarget(me: Me): Route | null {
  if (me.accounts.length === 0) return me.platformRole === 'admin' ? null : { name: 'onboarding' };
  const [only] = me.accounts;
  if (me.accounts.length === 1 && only && only.role === 'owner' && only.onboardingStep !== 'done') {
    return { name: 'onboarding', accountId: only.id };
  }
  return null;
}

function tourFor(me: Me): { key: string; needsFiscalConfig: boolean } | null {
  const ready = me.accounts.filter((a) => a.onboardingStep === 'done');
  const asked = new URLSearchParams(window.location.search).get('tour') === '1';
  if (ready.length === 0 || (me.tourSeenAt && !asked)) return null;
  return {
    key: `${me.userId}:${asked ? 'again' : 'first'}`,
    needsFiscalConfig: ready.some((a) => a.needsFiscalConfig),
  };
}

export function HomePage() {
  const me = useAsync(() => api.get<Me>('/api/me'), []);
  const target = me.data ? onboardingTarget(me.data) : null;
  // A path, not the route object: the effect runs once per destination.
  const targetHref = target ? routeHref(target) : null;
  useEffect(() => {
    if (targetHref) navigate(targetHref, { replace: true });
  }, [targetHref]);

  // The tour runs on the first visit with a finished account, or again on /app?tour=1.
  const tourOptions = me.data && !target ? tourFor(me.data) : null;
  useEffect(() => {
    if (!tourOptions) return;
    startTour({
      needsFiscalConfig: tourOptions.needsFiscalConfig,
      onDone: () => {
        void api.post('/api/me/tour-seen', {}).catch(() => undefined);
      },
    });
  }, [tourOptions?.key]);
  if (me.error) {
    return (
      <Layout title="NotaFlow">
        <Alert variant="error">{errorText(me.error)}</Alert>
      </Layout>
    );
  }
  if (!me.data || target) {
    return (
      <Layout title="NotaFlow">
        <Spinner />
      </Layout>
    );
  }
  const { data } = me;
  return (
    <Layout title={`Olá, ${data.name}`}>
      {data.accounts.length === 0 && (
        <Alert variant="info">
          <p>
            Você ainda não participa de nenhuma conta. Seu id de usuário é{' '}
            <code className="font-mono">{data.userId}</code>; envie-o ao administrador.
          </p>
        </Alert>
      )}
      {data.accounts.map((account) => (
        <section key={account.id} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={`${SECTION_TITLE_CLASSES} mb-0`}>{account.name}</h2>
            <Badge>{account.role === 'owner' ? 'dono' : 'membro'}</Badge>
            {account.status === 'suspended' && <Badge variant="warning">suspensa</Badge>}
          </div>
          {account.onboardingStep !== 'done' && account.role === 'owner' && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <OptionCard
                option={{
                  route: { name: 'onboarding', accountId: account.id },
                  title: 'Continuar cadastro',
                  text: 'Termine o cadastro da empresa para emitir e importar notas.',
                }}
              />
            </div>
          )}
          {account.onboardingStep !== 'done' && account.role !== 'owner' && (
            <Alert variant="info">O dono da conta ainda está concluindo o cadastro.</Alert>
          )}
          {account.onboardingStep === 'done' && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {optionsFor(account).map((option) => (
                <OptionCard key={option.title} option={option} />
              ))}
            </div>
          )}
        </section>
      ))}
      {data.platformRole === 'admin' && (
        <section className="flex flex-col gap-3">
          <h2 className={`${SECTION_TITLE_CLASSES} mb-0`}>Plataforma</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <OptionCard
              option={{
                route: { name: 'admin' },
                title: 'Painel do administrador',
                text: 'Contas, usuários, vínculos e auditoria.',
              }}
            />
          </div>
        </section>
      )}
    </Layout>
  );
}
