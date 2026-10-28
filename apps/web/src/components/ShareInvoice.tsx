import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { track } from '../analytics/analytics';
import { api } from '../api';
import { Button, CheckIcon, IconButton, Input, LinkIcon, ShareIcon } from '../ui';
import { errorText } from './Layout';
import { placePanel } from './sharePlacement';

type Channel = 'copy' | 'native' | 'whatsapp' | 'mailto' | 'notaflow_email';

const ITEM_CLASSES =
  'block w-full px-3 py-2 text-left text-sm text-fg hover:bg-muted/10 focus:bg-muted/10 focus:outline-none';

// Behind an object so a test can watch it: jsdom cannot navigate.
export const mailtoNavigation = {
  open(url: string) {
    window.location.href = url;
  },
};

export function ShareInvoice(props: {
  accountId: string;
  invoiceId: string;
  number: string | null;
  emitterName: string;
  // Opens the NotaFlow e-mail dialog; the menu item exists only when this is set.
  onNotaflowEmail?: () => void;
  // The first link of this invoice was just created.
  onLinkCreated?: () => void;
  // "icon" is the list look: two icon buttons; "text" adds the words.
  variant?: 'text' | 'icon';
}) {
  const { accountId, invoiceId, number, emitterName, onNotaflowEmail, onLinkCreated } = props;
  const icon = props.variant === 'icon';
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pending = useRef<Promise<string> | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLUListElement>(null);
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null);
  const panelId = useId();

  // One request per invoice per page view; a failure clears the cache so a retry asks again.
  function getUrl(): Promise<string> {
    if (!pending.current) {
      const path = `/api/accounts/${encodeURIComponent(accountId)}/invoices/${encodeURIComponent(invoiceId)}/link`;
      pending.current = api.post<{ url: string }>(path, {}).then(
        (answer) => {
          setUrl(answer.url);
          onLinkCreated?.();
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
        window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
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
    if (returnFocus) trigger.current?.focus();
  }

  // The panel is in a portal: a list row clips what overflows it. Fixed to the trigger, kept there on scroll and resize.
  useLayoutEffect(() => {
    if (!menuOpen) {
      setSpot(null);
      return;
    }
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const box = panel.current?.getBoundingClientRect();
      if (!anchor) return;
      setSpot(
        placePanel({
          trigger: anchor,
          panel: { width: box?.width ?? 0, height: box?.height ?? 0 },
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [menuOpen, url, error]);

  // React events bubble from the portal to the root, so this covers the trigger and the panel even under a parent that stops keydown.
  function onKeyDown(event: KeyboardEvent) {
    if (!menuOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('button') ?? [])];
    const first = items[0];
    const last = items[items.length - 1];
    if (event.target === trigger.current && !event.shiftKey && first) {
      event.preventDefault();
      first.focus();
    } else if (event.target === first && event.shiftKey) {
      event.preventDefault();
      trigger.current?.focus();
    } else if (event.target === last && !event.shiftKey) {
      event.preventDefault();
      closeMenu(true);
    }
  }

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: Event) => {
      const inside = (node: Element | null) => node?.contains(event.target as Node) ?? false;
      if (event.target instanceof Node && !inside(root.current) && !inside(panel.current)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('focusin', onPointer);
    // Also on the document: focus may sit on <body> after the item that held it unmounted.
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu(true);
    };
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('focusin', onPointer);
      document.removeEventListener('keydown', onEscape);
    };
  }, [menuOpen]);

  const picked = (channel: Channel) => {
    track('danfse_shared', { channel });
    closeMenu(false);
  };

  // The link is a bearer credential: session recordings must not capture it, in text or in an attribute.
  return (
    <div ref={root} className="ph-no-capture contents" onKeyDown={onKeyDown}>
      {icon ? (
        <>
          <IconButton label={copied ? 'Link copiado' : 'Copiar link'} onClick={copy}>
            {copied ? <CheckIcon className="size-5 text-success" /> : <LinkIcon />}
          </IconButton>
          <IconButton
            ref={trigger}
            label="Compartilhar"
            aria-expanded={menuOpen}
            aria-controls={panelId}
            onClick={toggleMenu}
          >
            <ShareIcon />
          </IconButton>
        </>
      ) : (
        <>
          <Button size="sm" variant="secondary" onClick={copy}>
            <span className="inline-flex items-center gap-2">
              {copied ? (
                <CheckIcon className="size-4 text-success" />
              ) : (
                <LinkIcon className="size-4" />
              )}
              Copiar link
            </span>
          </Button>
          <Button
            ref={trigger}
            size="sm"
            variant="secondary"
            aria-expanded={menuOpen}
            aria-controls={panelId}
            onClick={toggleMenu}
          >
            <span className="inline-flex items-center gap-2">
              <ShareIcon className="size-4" />
              Compartilhar
            </span>
          </Button>
        </>
      )}
      {menuOpen &&
        createPortal(
          <ul
            ref={panel}
            id={panelId}
            className="ph-no-capture z-50 min-w-56 rounded border border-border bg-surface py-1 shadow-sm"
            style={{
              position: 'fixed',
              top: spot?.top ?? 0,
              left: spot?.left ?? 0,
              visibility: spot ? 'visible' : 'hidden',
            }}
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
                  <button
                    type="button"
                    className={ITEM_CLASSES}
                    onClick={() => {
                      window.open(
                        `https://wa.me/?text=${encodeURIComponent(shareText(url))}`,
                        '_blank',
                        'noopener,noreferrer',
                      );
                      picked('whatsapp');
                    }}
                  >
                    WhatsApp
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className={ITEM_CLASSES}
                    onClick={() => {
                      mailtoNavigation.open(
                        `mailto:?subject=${encodeURIComponent(label)}&body=${encodeURIComponent(shareText(url))}`,
                      );
                      picked('mailto');
                    }}
                  >
                    E-mail pelo seu app
                  </button>
                </li>
                {onNotaflowEmail && (
                  <li>
                    <button
                      type="button"
                      className={ITEM_CLASSES}
                      onClick={() => {
                        // Close the panel first, so one Escape never closes it and the dialog.
                        closeMenu(false);
                        onNotaflowEmail();
                      }}
                    >
                      Enviar por e-mail (NotaFlow)
                    </button>
                  </li>
                )}
              </>
            )}
          </ul>,
          document.body,
        )}
      <div aria-live="polite" className={copied && !icon ? 'w-full text-sm text-muted' : 'sr-only'}>
        {copied && 'Link copiado.'}
      </div>
      {manual && url && (
        <Input
          className="w-full"
          readOnly
          aria-label="Link da nota"
          value={url}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
      {error && (url || !menuOpen) && (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
