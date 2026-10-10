import type { Environment } from '../api';
import { routeHref } from '../router';
import { Alert, Button, Link, Spinner } from '../ui';
import { EnvironmentBadge } from './EnvironmentBadge';
import { Layout } from './Layout';
import type { IssueSend } from './useIssueSend';

// The screens after a rejected or an unconfirmed send, shared by both issue pages.
export function IssueResultView(props: {
  accountId: string;
  title: string;
  environment: Environment;
  send: IssueSend<unknown>;
}) {
  const { accountId, send } = props;
  const { result } = send;
  if (!result) return null;
  return (
    <Layout title={props.title} accountId={accountId}>
      <EnvironmentBadge environment={props.environment} />
      {result.status === 'rejected' ? (
        <Alert variant="error">
          <div className="flex flex-col gap-1">
            <strong>A Sefin recusou a nota.</strong>
            {result.errors?.map((e) => (
              <span key={`${e.code}-${e.message}`}>
                {e.code}: {e.message}
              </span>
            ))}
          </div>
        </Alert>
      ) : (
        <Alert variant="warning">
          A Sefin não confirmou. Não emita de novo; verifique o resultado.
        </Alert>
      )}
      {send.error && <Alert variant="error">{send.error}</Alert>}
      <div className="flex flex-wrap gap-3">
        {result.status === 'rejected' ? (
          <Button variant="secondary" onClick={() => send.backToEdit()}>
            Voltar e editar
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={send.busy}
            onClick={() => void send.verify(result.id)}
          >
            Verificar agora
          </Button>
        )}
        <Link href={routeHref({ name: 'invoice', accountId, invoiceId: result.id })}>
          Ver a nota
        </Link>
        {send.busy && <Spinner label="Verificando" />}
      </div>
    </Layout>
  );
}
