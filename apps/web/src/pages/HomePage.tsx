import { api, type Me } from '../api';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { type Route, routeHref } from '../router';
import { Alert, Badge, CARD_CLASSES, SECTION_TITLE_CLASSES, Spinner } from '../ui';

interface Option {
  route: Route;
  title: string;
  text: string;
}

function optionsFor(account: Me['accounts'][number]): Option[] {
  const accountId = account.id;
  return [
    {
      route: { name: 'invoices', accountId },
      title: 'Notas',
      text: 'Veja, filtre e baixe as notas, e use uma delas para emitir outra.',
    },
    {
      route: { name: 'newInvoice', accountId },
      title: 'Nova nota',
      text: 'Emita uma nota para um cliente, sem modelo.',
    },
    {
      route: { name: 'emitters', accountId },
      title: 'Emitentes',
      text: 'Empresas que emitem, certificado digital e sincronização.',
    },
    {
      route: { name: 'customers', accountId },
      title: 'Clientes',
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
      className={`${CARD_CLASSES} flex flex-col gap-1 transition-colors hover:border-primary/60 hover:bg-muted/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}
    >
      <span className="font-display text-lg font-semibold text-fg">{option.title}</span>
      <span className="text-sm text-muted">{option.text}</span>
    </a>
  );
}

export function HomePage() {
  const me = useAsync(() => api.get<Me>('/api/me'), []);
  if (me.error) {
    return (
      <Layout title="NotaFlow">
        <Alert variant="error">{errorText(me.error)}</Alert>
      </Layout>
    );
  }
  if (!me.data) {
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {optionsFor(account).map((option) => (
              <OptionCard key={option.title} option={option} />
            ))}
          </div>
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
