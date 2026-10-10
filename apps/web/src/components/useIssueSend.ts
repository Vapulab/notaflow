import { useState } from 'react';
import { ApiError, api, type IssueResult } from '../api';
import { routeHref } from '../router';
import { errorText } from './Layout';

export const UNCERTAIN_TEXT =
  'Não houve resposta clara. A nota pode ter sido emitida: tente de novo aqui, sem emitir outra.';

// Refusals the server makes before it reserves a DPS number; every other answer may have issued.
const DEFINITIVE_5XX = new Set(['ptax_unavailable']);

export function isDefinitive(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status >= 500) return DEFINITIVE_5XX.has(error.code);
  return error.status >= 400 && error.status !== 408 && error.status !== 429;
}

export interface IssueSend<F> {
  key: string | null; // the idempotency key while reviewing or locked
  locked: boolean; // an unclear answer: only a retry with the same key is safe
  busy: boolean;
  error: string | null;
  result: IssueResult | null; // rejected or unknown; issued navigates away
  restored: F | null; // the reviewed form after a reload with a pending send
  startReview(): void;
  backToEdit(): void;
  send(form: F, path: string, body: unknown): Promise<void>;
  verify(invoiceId: string): Promise<void>;
}

interface PendingSend<F> {
  key: string;
  form: F;
}

// One key per review; a send that may have reached the Sefin survives a reload with its key and values.
export function useIssueSend<F>(options: { accountId: string; storageKey: string }): IssueSend<F> {
  const { accountId, storageKey } = options;
  const [pending] = useState(() => readPendingSend<F>(storageKey));
  const [key, setKey] = useState<string | null>(pending?.key ?? null);
  const [locked, setLocked] = useState(pending !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(pending ? UNCERTAIN_TEXT : null);
  const [result, setResult] = useState<IssueResult | null>(null);
  const base = `/api/accounts/${encodeURIComponent(accountId)}`;

  const open = (invoiceId: string) => {
    window.location.hash = routeHref({ name: 'invoice', accountId, invoiceId });
  };

  return {
    key,
    locked,
    busy,
    error,
    result,
    restored: pending?.form ?? null,
    startReview() {
      setError(null);
      setKey(crypto.randomUUID());
    },
    backToEdit() {
      if (locked) return;
      setResult(null);
      setKey(null);
    },
    async send(form, path, body) {
      if (!key) return;
      setBusy(true);
      setError(null);
      writePendingSend(storageKey, { key, form });
      try {
        const answer = await api.post<IssueResult>(path, body, { 'idempotency-key': key });
        clearPendingSend(storageKey);
        setLocked(false);
        if (answer.status === 'issued') {
          open(answer.id);
          return;
        }
        setResult(answer);
      } catch (failure) {
        if (isDefinitive(failure)) {
          clearPendingSend(storageKey);
          setLocked(false);
          setError(errorText(failure));
        } else {
          setLocked(true);
          setError(UNCERTAIN_TEXT);
        }
      } finally {
        setBusy(false);
      }
    },
    async verify(invoiceId) {
      setBusy(true);
      try {
        const answer = await api.post<IssueResult>(
          `${base}/invoices/${encodeURIComponent(invoiceId)}/reconcile`,
          {},
        );
        if (answer.status === 'issued') {
          open(invoiceId);
          return;
        }
        setResult(answer);
      } catch (failure) {
        setError(errorText(failure));
      } finally {
        setBusy(false);
      }
    },
  };
}

function readPendingSend<F>(storageKey: string): PendingSend<F> | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as PendingSend<F>) : null;
  } catch {
    return null;
  }
}

function writePendingSend<F>(storageKey: string, value: PendingSend<F>): void {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Without storage, a reload loses the key; the server state is still safe.
  }
}

function clearPendingSend(storageKey: string): void {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // Nothing to clear.
  }
}
