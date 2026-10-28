import type { Emitter } from '../api';
import { routeHref } from '../router';
import { Link } from '../ui';

// Next to "Emitir": says the customer gets the link by e-mail and where to turn it off.
// Produção restrita never sends by itself, so the note would be false there.
export function CustomerEmailNote(props: {
  accountId: string;
  emitter: Pick<Emitter, 'id' | 'autoEmailCustomer' | 'environment'>;
}) {
  const { emitter } = props;
  if (!emitter.autoEmailCustomer || emitter.environment !== 'producao') return null;
  return (
    <p className="text-sm text-muted">
      O tomador vai receber por e-mail, se a nota tiver o e-mail dele.{' '}
      <Link
        href={routeHref({
          name: 'emitter',
          accountId: props.accountId,
          emitterId: emitter.id,
        })}
        variant="muted"
      >
        Mudar na configuração do emitente
      </Link>
    </p>
  );
}
