import { routeHref } from '../router';
import { Link } from '../ui';

// Next to "Emitir": says the customer gets the link by e-mail and where to turn it off.
export function CustomerEmailNote(props: {
  accountId: string;
  emitterId: string;
  enabled: boolean;
}) {
  if (!props.enabled) return null;
  return (
    <p className="text-sm text-muted">
      O tomador vai receber por e-mail.{' '}
      <Link
        href={routeHref({
          name: 'emitter',
          accountId: props.accountId,
          emitterId: props.emitterId,
        })}
        variant="muted"
      >
        Mudar na configuração do emitente
      </Link>
    </p>
  );
}
