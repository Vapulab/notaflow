import { type FormEvent, useEffect, useState } from 'react';
import { track } from '../analytics/analytics';
import { api, type InvoiceDetail } from '../api';
import { Alert, Button, Field, Input, Modal } from '../ui';
import { errorText } from './Layout';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SendInvoiceEmail(props: {
  accountId: string;
  invoiceId: string;
  number: string | null;
  open: boolean;
  onClose: () => void;
  onSent?: () => void;
}) {
  const { accountId, invoiceId, number, open, onClose, onSent } = props;
  const url = `/api/accounts/${encodeURIComponent(accountId)}/invoices/${encodeURIComponent(invoiceId)}`;
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The address the customer has on the note, else on the customer record, comes from the detail.
  useEffect(() => {
    if (!open) return;
    setSent(false);
    setError(null);
    let current = true;
    void api.get<InvoiceDetail>(url).then(
      (detail) => {
        if (current && detail.customerEmail)
          setTo((typed) => typed || (detail.customerEmail ?? ''));
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [open, url]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const address = to.trim();
    if (!EMAIL.test(address)) {
      setError('Digite um e-mail válido.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`${url}/email`, { to: address });
      setSent(true);
      track('danfse_shared', { channel: 'notaflow_email' });
      onSent?.();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={`Enviar a NFS-e ${number ?? ''} por e-mail`} onClose={onClose}>
      {sent ? (
        <div className="flex flex-col gap-4">
          <Alert variant="info">E-mail enviado para {to.trim()}.</Alert>
          <div>
            <Button variant="secondary" onClick={onClose}>
              Fechar
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
          <Field
            label="E-mail do tomador"
            hint="O e-mail leva o link da nota. As respostas chegam ao seu e-mail."
          >
            <Input
              type="email"
              autoComplete="off"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
          {error && <Alert variant="error">{error}</Alert>}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="primary" disabled={busy}>
              Enviar
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
