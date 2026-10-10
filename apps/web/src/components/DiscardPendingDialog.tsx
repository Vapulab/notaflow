import { routeHref } from '../router';
import { Alert, Button, Link, Modal } from '../ui';

// The only way out of a locked send other than "Tentar de novo"; the user checks the list first.
export function DiscardPendingDialog(props: {
  accountId: string;
  open: boolean;
  onCancel: () => void;
  onDiscard: () => void;
}) {
  return (
    <Modal open={props.open} title="Descartar envio pendente" onClose={props.onCancel}>
      <div className="flex flex-col gap-4">
        <Alert variant="warning">
          A Sefin pode ter emitido esta nota. Antes de descartar, abra a lista de notas: uma nota
          pendente ou incerta aparece lá, e "Verificar" diz se ela existe. Descartar e emitir de
          novo uma nota que já existe gera uma nota em duplicidade.
        </Alert>
        <Link href={routeHref({ name: 'invoices', accountId: props.accountId })}>Ver as notas</Link>
        <div className="flex gap-3">
          <Button variant="danger" onClick={props.onDiscard}>
            Descartar
          </Button>
          <Button variant="secondary" onClick={props.onCancel}>
            Manter o envio
          </Button>
        </div>
      </div>
    </Modal>
  );
}
