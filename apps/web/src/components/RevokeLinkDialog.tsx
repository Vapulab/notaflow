import { useState } from 'react';
import { api } from '../api';
import { Alert, Button, Modal } from '../ui';
import { errorText } from './Layout';

export function RevokeLinkDialog(props: {
  accountId: string;
  invoiceId: string;
  onClose: () => void;
  onRevoked: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await api.delete(
        `/api/accounts/${encodeURIComponent(props.accountId)}/invoices/${encodeURIComponent(props.invoiceId)}/link`,
      );
      props.onRevoked();
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  }

  return (
    <Modal open title="Revogar o link da nota?" onClose={props.onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg">
          Quem já recebeu o link perde o acesso ao PDF. Um novo link pode ser criado depois.
        </p>
        {error && <Alert variant="error">{error}</Alert>}
        <div className="flex flex-wrap gap-3">
          <Button variant="danger" disabled={busy} onClick={() => void revoke()}>
            Revogar
          </Button>
          <Button variant="secondary" disabled={busy} onClick={props.onClose}>
            Voltar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
