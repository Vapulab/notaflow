import { useEffect, useId, useRef, useState } from 'react';
import { track } from '../analytics/analytics';
import { api } from '../api';
import { Button, Input } from '../ui';
import { errorText } from './Layout';

type Channel = 'copy' | 'native' | 'whatsapp' | 'mailto' | 'notaflow_email';

const ITEM_CLASSES =
  'block w-full px-3 py-2 text-left text-sm text-fg hover:bg-muted/10 focus:bg-muted/10 focus:outline-none';

export function ShareInvoice(props: {
  accountId: string;
  invoiceId: string;
  number: string | null;
  emitterName: string;
  // Opens the NotaFlow e-mail dialog; the menu item exists only when this is set.
  onNotaflowEmail?: () => void;
}) {
  const { accountId, invoiceId, number, emitterName, onNotaflowEmail } = props;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pending = useRef<Promise<string> | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // One request per invoice per page view; a failure clears the cache so a retry asks again.
  function getUrl(): Promise<string> {
    if (!pending.current) {
      const path = `/api/accounts/${encodeURIComponent(accountId)}/invoices/${encodeURIComponent(invoiceId)}/link`;
      pending.current = api.post<{ url: string }>(path, {}).then(
        (answer) => {
          setUrl(answer.url);
          return answer.url;
        },
        (failure: unknown) => {
          pending.current = null;
          throw failure;
        },
      );
    }
    return pending.current;
  }

  async function withUrl(action: (link: string) => Promise<void>) {
    setError(null);
    try {
      await action(await getUrl());
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  const label = `NFS-e nº ${number ?? ''} de ${emitterName}`;
  const shareText = (link: string) => `Segue a NFS-e nº ${number ?? ''} de ${emitterName}: ${link}`;

  function copy() {
    setCopied(false);
    setManual(false);
    void withUrl(async (link) => {
      try {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        track('danfse_shared', { channel: 'copy' satisfies Channel });
      } catch {
        setManual(true);
      }
    });
  }

  function toggleMenu() {
    const opening = !menuOpen;
    setMenuOpen(opening);
    if (opening) void withUrl(async () => {});
  }

  // Called straight from the click: an await before navigator.share breaks the user activation on iOS.
  function nativeShare(link: string) {
    navigator.share({ text: shareText(link) }).then(
      () => track('danfse_shared', { channel: 'native' satisfies Channel }),
      (failure: unknown) => {
        const name = failure instanceof DOMException ? failure.name : '';
        if (name !== 'AbortError' && name !== 'NotAllowedError') setError(errorText(failure));
      },
    );
    setMenuOpen(false);
  }

  function closeMenu(returnFocus: boolean) {
    setMenuOpen(false);
    if (returnFocus) root.current?.querySelector<HTMLElement>('[aria-controls]')?.focus();
  }

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: Event) => {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu(true);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('focusin', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('focusin', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const picked = (channel: Channel) => {
    track('danfse_shared', { channel });
    closeMenu(false);
  };

  return (
    <div ref={root} className="relative flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={copy}>
          Copiar link
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-expanded={menuOpen}
          aria-controls={panelId}
          onClick={toggleMenu}
        >
          Compartilhar
        </Button>
      </div>
      {menuOpen && (
        <ul
          id={panelId}
          className="absolute left-0 top-full z-10 mt-1 min-w-56 rounded border border-border bg-surface py-1 shadow-sm"
        >
          {!url && error && (
            <li className="flex flex-col gap-1 px-3 py-2">
              <span role="alert" className="text-sm text-danger">
                {error}
              </span>
              <Button size="sm" variant="secondary" onClick={() => void withUrl(async () => {})}>
                Tentar de novo
              </Button>
            </li>
          )}
          {!url && !error && <li className="px-3 py-2 text-sm text-muted">Gerando o link…</li>}
          {url && (
            <>
              {typeof navigator.share === 'function' && (
                <li>
                  <button type="button" className={ITEM_CLASSES} onClick={() => nativeShare(url)}>
                    Compartilhar pelo celular
                  </button>
                </li>
              )}
              <li>
                <a
                  className={ITEM_CLASSES}
                  href={`https://wa.me/?text=${encodeURIComponent(shareText(url))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => picked('whatsapp')}
                >
                  WhatsApp
                </a>
              </li>
              <li>
                <a
                  className={ITEM_CLASSES}
                  href={`mailto:?subject=${encodeURIComponent(label)}&body=${encodeURIComponent(shareText(url))}`}
                  onClick={() => picked('mailto')}
                >
                  E-mail pelo seu app
                </a>
              </li>
              {onNotaflowEmail && (
                <li>
                  <button
                    type="button"
                    className={ITEM_CLASSES}
                    onClick={() => {
                      picked('notaflow_email');
                      onNotaflowEmail();
                    }}
                  >
                    Enviar por e-mail (NotaFlow)
                  </button>
                </li>
              )}
            </>
          )}
        </ul>
      )}
      <div aria-live="polite" className="text-sm text-muted">
        {copied && 'Link copiado.'}
      </div>
      {manual && url && (
        <Input
          readOnly
          aria-label="Link da nota"
          value={url}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
      {error && (url || !menuOpen) && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
