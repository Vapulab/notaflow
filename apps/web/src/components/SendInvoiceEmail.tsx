import { type FormEvent, useEffect, useState } from 'react';
import { track } from '../analytics/analytics';
import { api, ApiError, type InvoiceDetail } from '../api';
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
  // The address a bounce blocked, which the emitter may confirm.
  const [confirmable, setConfirmable] = useState<string | null>(null);

  // The address the customer has on the note, else on the customer record, comes from the detail.
  useEffect(() => {
    if (!open) return;
    setSent(false);
    setError(null);
    setConfirmable(null);
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

  async function send(address: string, confirmAddress: boolean) {
    setBusy(true);
    setError(null);
    setConfirmable(null);
    try {
      await api.post(
        `${url}/email`,
        confirmAddress ? { to: address, confirmAddress } : { to: address },
      );
      setSent(true);
      track('danfse_shared', { channel: 'notaflow_email' });
      onSent?.();
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'email_invalid_address') {
        setConfirmable(address);
      }
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const address = to.trim();
    if (!EMAIL.test(address)) {
      setError('Digite um e-mail válido.');
      return;
    }
    void send(address, false);
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
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field
            label="E-mail do tomador"
            hint="O e-mail leva o link da nota. As respostas chegam ao seu e-mail."
          >
            <Input
              type="email"
              autoComplete="off"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setConfirmable(null);
              }}
            />
          </Field>
          {error && <Alert variant="error">{error}</Alert>}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="primary" disabled={busy}>
              Enviar
            </Button>
            {confirmable && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void send(confirmable, true)}
              >
                O endereço está certo, enviar mesmo assim
              </Button>
            )}
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
