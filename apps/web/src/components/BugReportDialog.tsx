import { type ClipboardEvent, useState } from 'react';
import { api } from '../api';
import type { PublicConfig } from '../auth/PublicLayout';
import { Alert, Button, Field, FileInput, Input, Modal, Select, Textarea } from '../ui';
import {
  BUG_IMAGE_TYPES,
  ImageTooLargeError,
  MAX_BUG_IMAGES,
  type PreparedImage,
  prepareBugImage,
} from './bugImages';
import { errorText } from './Layout';
import { useAsync } from './useAsync';

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 4000;

interface Attached extends PreparedImage {
  key: number;
  name: string;
}

let nextKey = 0;

// accountId: the account of the page; outside one, the person's only account, or a choice among several.
export function BugReportDialog(props: {
  open: boolean;
  accountId?: string;
  accounts: { id: string; name: string }[];
  onClose: () => void;
}) {
  const only = props.accounts.length === 1 ? props.accounts[0]?.id : undefined;
  const [chosen, setChosen] = useState('');
  const accountId = props.accountId ?? only ?? chosen;
  const choosing = props.accountId === undefined && only === undefined;
  // Asked when the dialog opens, so a page that never opens it makes no request.
  const config = useAsync(
    () => (props.open ? api.get<PublicConfig>('/api/public/config') : Promise.resolve(null)),
    [props.open],
  );
  const screenshots = config.data?.bugScreenshots === true;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<Attached[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [imageError, setImageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function close() {
    if (sent) {
      setTitle('');
      setDescription('');
      setImages([]);
      setSent(false);
    }
    setError(null);
    setImageError(null);
    props.onClose();
  }

  async function addFiles(files: File[]) {
    setImageError(null);
    const accepted = files.filter((file) => BUG_IMAGE_TYPES.includes(file.type));
    if (accepted.length < files.length) setImageError('Anexe imagens PNG, JPEG ou WebP.');
    const room = MAX_BUG_IMAGES - images.length - preparing;
    if (accepted.length > room) {
      setImageError(`Anexe no máximo ${MAX_BUG_IMAGES} imagens.`);
    }
    const chosen = accepted.slice(0, Math.max(0, room));
    setPreparing((n) => n + chosen.length);
    for (const file of chosen) {
      const name = file.name || 'colada';
      try {
        const prepared = await prepareBugImage(file);
        setImages((list) => [...list, { ...prepared, key: nextKey++, name }]);
      } catch (failure) {
        setImageError(
          failure instanceof ImageTooLargeError
            ? `A imagem ${name} passa de 1 MB mesmo reduzida. Recorte só a parte que mostra o erro e anexe de novo.`
            : `Não conseguimos ler a imagem ${name}. Tente outra.`,
        );
      } finally {
        setPreparing((n) => n - 1);
      }
    }
  }

  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    if (!screenshots) return;
    const files = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith('image/'),
    );
    // A paste of plain text has no files and goes into the field as usual.
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/accounts/${encodeURIComponent(accountId)}/bug-reports`, {
        title: title.trim(),
        description: description.trim(),
        pagePath: window.location.pathname,
        ...(images.length > 0
          ? { images: images.map(({ contentType, data }) => ({ contentType, data })) }
          : {}),
      });
      setSent(true);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  const full = images.length + preparing >= MAX_BUG_IMAGES;

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
        <div className="flex flex-col gap-4" onPaste={onPaste}>
          {choosing && (
            <Field label="Empresa">
              <Select value={chosen} onChange={(e) => setChosen(e.target.value)}>
                <option value="" disabled>
                  Escolha a empresa
                </option>
                {props.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
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
          {screenshots && (
            <>
              <Field
                label="Imagens (opcional)"
                hint={`Até ${MAX_BUG_IMAGES} capturas de tela. Escolha os arquivos ou cole com Ctrl+V.`}
              >
                <FileInput
                  accept={BUG_IMAGE_TYPES.join(',')}
                  multiple
                  disabled={full}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    void addFiles(files);
                  }}
                />
              </Field>
              {images.length > 0 && (
                <ul className="flex flex-wrap gap-3">
                  {images.map((image, index) => (
                    <li key={image.key} className="flex flex-col items-start gap-1">
                      <img
                        src={`data:${image.contentType};base64,${image.data}`}
                        alt={`Imagem ${index + 1}`}
                        className="h-20 w-32 rounded border border-border object-cover"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Remover imagem ${index + 1}`}
                        onClick={() =>
                          setImages((list) => list.filter((item) => item.key !== image.key))
                        }
                      >
                        Remover
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {imageError && <Alert variant="warning">{imageError}</Alert>}
            </>
          )}
          <p className="text-xs text-muted">
            O título e a descrição viram uma issue pública no GitHub, com CPF, CNPJ, e-mail e
            telefone ocultos. Não escreva nomes ou outros dados dos seus clientes.
            {screenshots &&
              ' As imagens nunca vão para o GitHub: só a equipe do NotaFlow as vê, e elas são apagadas 30 dias depois da correção.'}
          </p>
          {error && <Alert variant="error">{error}</Alert>}
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={busy || preparing > 0 || !accountId || !title.trim() || !description.trim()}
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
