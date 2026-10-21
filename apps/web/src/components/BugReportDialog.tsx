import { useState } from 'react';
import { api } from '../api';
import { Alert, Button, Field, Input, Modal, Textarea } from '../ui';
import { errorText } from './Layout';

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 4000;

export function BugReportDialog(props: { open: boolean; accountId: string; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function close() {
    if (sent) {
      setTitle('');
      setDescription('');
      setSent(false);
    }
    setError(null);
    props.onClose();
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/accounts/${props.accountId}/bug-reports`, {
        title: title.trim(),
        description: description.trim(),
        pagePath: window.location.pathname,
      });
      setSent(true);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={props.open} title="Reportar bug" onClose={close}>
      {sent ? (
        <div className="flex flex-col gap-4">
          <Alert variant="success">
            Obrigado! Recebemos o seu relato e vamos responder pelo e-mail da conta.
          </Alert>
          <div>
            <Button variant="secondary" onClick={close}>
              Fechar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Título">
            <Input maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="O que aconteceu?" hint={`${description.length}/${DESCRIPTION_MAX}`}>
            <Textarea
              maxLength={DESCRIPTION_MAX}
              rows={6}
              placeholder="O que você fez, o que esperava que acontecesse e o que aconteceu."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          {error && <Alert variant="error">{error}</Alert>}
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={busy || !title.trim() || !description.trim()}
              onClick={() => void send()}
            >
              Enviar
            </Button>
            <Button variant="secondary" disabled={busy} onClick={close}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
