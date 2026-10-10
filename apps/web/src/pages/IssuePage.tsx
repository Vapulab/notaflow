import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  api,
  type Customer,
  type Draft,
  type Emitter,
  type ExchangeRate,
  type IssueResult,
} from '../api';
import { EnvironmentBadge } from '../components/EnvironmentBadge';
import { Layout, errorText } from '../components/Layout';
import { showsEnvironment, useMe } from '../components/MeContext';
import { useAsync } from '../components/useAsync';
import {
  brasiliaToday,
  centsInput,
  formatCents,
  formatCompetence,
  formatDate,
  parseCents,
  previousMonthEnd,
} from '../format';
import { routeHref } from '../router';
import {
  Alert,
  Button,
  CARD_CLASSES,
  Card,
  Field,
  FORM_CLASSES,
  Input,
  Link,
  SECTION_TITLE_CLASSES,
  Select,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  Textarea,
} from '../ui';

interface Form {
  competence: string;
  brl: string;
  foreign: string;
  description: string;
  customerId: string;
}

const SAME_CUSTOMER = '';

export function IssuePage(props: { accountId: string; invoiceId: string }) {
  const { accountId, invoiceId } = props;
  const base = `/api/accounts/${encodeURIComponent(accountId)}`;
  const draft = useAsync(
    () => api.get<Draft>(`${base}/invoices/${encodeURIComponent(invoiceId)}/draft`),
    [base, invoiceId],
  );
  const emitters = useAsync(() => api.get<Emitter[]>(`${base}/emitters`), [base]);
  const customers = useAsync(() => api.get<Customer[]>(`${base}/customers`), [base]);

  if (draft.error) {
    return (
      <Layout title="Emitir parecida" accountId={accountId}>
        <Alert variant="error">{errorText(draft.error)}</Alert>
      </Layout>
    );
  }
  const emitter = emitters.data?.find((e) => e.id === draft.data?.emitterId);
  if (!draft.data || !emitter) {
    return (
      <Layout title="Emitir parecida" accountId={accountId}>
        <Spinner />
      </Layout>
    );
  }
  const choices = (customers.data ?? []).filter(
    (c) => c.emitterId === emitter.id && c.documentType !== 'NONE' && c.document,
  );
  return (
    <IssueFlow
      accountId={accountId}
      base={base}
      draft={draft.data}
      emitter={emitter}
      customers={choices}
    />
  );
}

function IssueFlow(props: {
  accountId: string;
  base: string;
  draft: Draft;
  emitter: Emitter;
  customers: Customer[];
}) {
  const { accountId, base, draft, emitter, customers } = props;
  const storageKey = `notaflow-issue-${draft.templateInvoiceId}`;
  // A send that may have reached the Sefin survives a reload, with its key and values.
  const [pendingSend] = useState(() => readPendingSend(storageKey));
  const [form, setForm] = useState<Form>(
    pendingSend?.form ?? {
      competence: previousMonthEnd(brasiliaToday()),
      brl: centsInput(draft.serviceCents),
      foreign: draft.foreign ? centsInput(draft.foreign.amountCents) : '',
      description: draft.description,
      customerId: SAME_CUSTOMER,
    },
  );
  const [rate, setRate] = useState<ExchangeRate | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  // One key per review: a retry of the same confirmation must not issue twice.
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(pendingSend?.key ?? null);
  // After an answer that does not say whether the invoice exists, only a retry with the same key is safe.
  const [locked, setLocked] = useState(pendingSend !== null);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(pendingSend ? UNCERTAIN_TEXT : null);
  const [result, setResult] = useState<IssueResult | null>(null);

  const brlCents = parseCents(form.brl);
  const foreignCents = draft.foreign ? parseCents(form.foreign) : null;
  const valid =
    brlCents !== null &&
    brlCents > 0 &&
    // An export is in reais at the PTAX of the competence; the server refuses any other amount.
    (!draft.foreign ||
      (foreignCents !== null && foreignCents > 0 && rate !== null && !rateLoading)) &&
    form.competence !== '' &&
    form.description.trim() !== '';
  const set = (field: keyof Form) => (value: string) => setForm((f) => ({ ...f, [field]: value }));
  const chosen = customers.find((c) => c.id === form.customerId);
  const customerName = chosen?.name ?? draft.customer?.name ?? '';
  const production = emitter.environment === 'producao';
  const namesEnvironment = showsEnvironment(useMe(), emitter.environment);

  // The review shows reviewed values; a rate arriving then must not change them.
  const reviewing = useRef(idempotencyKey !== null);
  reviewing.current = idempotencyKey !== null;
  const currencyCode = draft.foreign?.currencyCode;
  useEffect(() => {
    if (!currencyCode || foreignCents === null || foreignCents <= 0 || !form.competence) return;
    if (reviewing.current) return;
    let live = true;
    setRateLoading(true);
    // Waits for the user to stop typing before asking the Banco Central.
    const timer = setTimeout(() => {
      api
        .get<ExchangeRate>(`${base}/exchange-rate?currency=${currencyCode}&date=${form.competence}`)
        .then(
          (found) => {
            if (!live || reviewing.current) return;
            setRate(found);
            setRateError(null);
            setForm((f) => ({
              ...f,
              brl: centsInput(Math.round((foreignCents * found.rateE4) / 10_000)),
            }));
          },
          (error: unknown) => {
            if (!live) return;
            setRate(null);
            setRateError(errorText(error));
          },
        )
        .finally(() => {
          if (live) setRateLoading(false);
        });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [base, currencyCode, foreignCents, form.competence]);

  function review(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setSendError(null);
    setIdempotencyKey(crypto.randomUUID());
  }

  async function confirm() {
    if (!idempotencyKey || brlCents === null) return;
    setBusy(true);
    setSendError(null);
    writePendingSend(storageKey, { key: idempotencyKey, form });
    try {
      const answer = await api.post<IssueResult>(
        `${base}/invoices/issue`,
        {
          templateInvoiceId: draft.templateInvoiceId,
          competence: form.competence,
          serviceCents: brlCents,
          ...(foreignCents ? { foreignAmountCents: foreignCents } : {}),
          description: form.description.trim(),
          ...(form.customerId ? { customerId: form.customerId } : {}),
        },
        { 'idempotency-key': idempotencyKey },
      );
      clearPendingSend(storageKey);
      setLocked(false);
      if (answer.status === 'issued') {
        window.location.hash = routeHref({ name: 'invoice', accountId, invoiceId: answer.id });
        return;
      }
      setResult(answer);
    } catch (error) {
      if (isDefinitive(error)) {
        clearPendingSend(storageKey);
        setLocked(false);
        setSendError(errorText(error));
      } else {
        setLocked(true);
        setSendError(UNCERTAIN_TEXT);
      }
    } finally {
      setBusy(false);
    }
  }

  async function verify(id: string) {
    setBusy(true);
    try {
      const answer = await api.post<IssueResult>(
        `${base}/invoices/${encodeURIComponent(id)}/reconcile`,
        {},
      );
      if (answer.status === 'issued') {
        window.location.hash = routeHref({ name: 'invoice', accountId, invoiceId: id });
        return;
      }
      setResult(answer);
    } catch (error) {
      setSendError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Layout title="Emitir parecida" accountId={accountId}>
        <EnvironmentBadge environment={emitter.environment} />
        {result.status === 'rejected' ? (
          <Alert variant="error">
            <div className="flex flex-col gap-1">
              <strong>A Sefin recusou a nota.</strong>
              {result.errors?.map((e) => (
                <span key={`${e.code}-${e.message}`}>
                  {e.code}: {e.message}
                </span>
              ))}
            </div>
          </Alert>
        ) : (
          <Alert variant="warning">
            A Sefin não confirmou. Não emita de novo; verifique o resultado.
          </Alert>
        )}
        {sendError && <Alert variant="error">{sendError}</Alert>}
        <div className="flex flex-wrap gap-3">
          {result.status === 'rejected' ? (
            <Button
              variant="secondary"
              onClick={() => {
                setResult(null);
                setIdempotencyKey(null);
              }}
            >
              Voltar e editar
            </Button>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => void verify(result.id)}>
              Verificar agora
            </Button>
          )}
          <Link href={routeHref({ name: 'invoice', accountId, invoiceId: result.id })}>
            Ver a nota
          </Link>
        </div>
      </Layout>
    );
  }

  if (idempotencyKey) {
    const rows: { label: string; before: string; after: string }[] = [
      {
        label: 'Competência',
        before: formatCompetence(draft.competence),
        after: formatCompetence(form.competence),
      },
      {
        label: 'Valor em reais',
        before: formatCents(draft.serviceCents),
        after: formatCents(brlCents ?? 0),
      },
      ...(draft.foreign
        ? [
            {
              label: `Valor em ${draft.foreign.currency}`,
              before: centsInput(draft.foreign.amountCents),
              after: centsInput(foreignCents ?? 0),
            },
          ]
        : []),
      { label: 'Descrição', before: draft.description, after: form.description.trim() },
      { label: 'Tomador', before: draft.customer?.name ?? '', after: customerName },
    ];
    return (
      <Layout title="Revisar a nota" accountId={accountId}>
        <EnvironmentBadge environment={emitter.environment} />
        <Card>
          <Table>
            <THead>
              <tr>
                <TH>Campo</TH>
                <TH>Nota-modelo</TH>
                <TH>Nova nota</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((row) => (
                <tr key={row.label} className={row.before !== row.after ? 'bg-warning/10' : ''}>
                  <TH scope="row">{row.label}</TH>
                  <TD className="text-muted">{row.before}</TD>
                  <TD>{row.after}</TD>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
        {sendError && <Alert variant="error">{sendError}</Alert>}
        <div className="flex flex-wrap gap-3">
          <Button
            variant={production ? 'danger' : 'primary'}
            disabled={busy}
            onClick={() => void confirm()}
          >
            {locked
              ? 'Tentar de novo'
              : !namesEnvironment
                ? 'Emitir nota'
                : production
                  ? 'Emitir em PRODUÇÃO'
                  : 'Emitir em produção restrita'}
          </Button>
          {!locked && (
            <Button variant="secondary" disabled={busy} onClick={() => setIdempotencyKey(null)}>
              Voltar e editar
            </Button>
          )}
          {busy && <Spinner label="Emitindo" />}
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Emitir parecida" accountId={accountId}>
      <EnvironmentBadge environment={emitter.environment} />
      <form onSubmit={review} className={`${CARD_CLASSES} ${FORM_CLASSES}`}>
        <h2 className={SECTION_TITLE_CLASSES}>Nova nota a partir da nota-modelo</h2>
        <Field label="Competência">
          <Input
            type="date"
            required
            max={brasiliaToday()}
            value={form.competence}
            onChange={(e) => set('competence')(e.target.value)}
          />
        </Field>
        {draft.foreign && (
          <div className="flex flex-col gap-2">
            <Field label={`Valor em ${draft.foreign.currency}`}>
              <Input
                inputMode="decimal"
                value={form.foreign}
                onChange={(e) => set('foreign')(e.target.value)}
              />
            </Field>
            {rateLoading && <p className="text-sm text-muted">Buscando a cotação PTAX…</p>}
            {!rateLoading && rate && (
              <p className="text-sm text-muted">
                PTAX venda de {formatDate(`${rate.date}T12:00:00Z`)}: {rate.rate.replace('.', ',')}
              </p>
            )}
            {rateError && <Alert variant="warning">{rateError}</Alert>}
          </div>
        )}
        <Field label="Valor em reais">
          <Input
            inputMode="decimal"
            readOnly={draft.foreign !== null}
            value={form.brl}
            onChange={(e) => set('brl')(e.target.value)}
          />
        </Field>
        {brlCents === null && <p className="text-sm text-danger">Valor inválido.</p>}
        <Field label="Descrição">
          <Textarea
            maxLength={2000}
            value={form.description}
            onChange={(e) => set('description')(e.target.value)}
          />
        </Field>
        <Field label="Tomador">
          <Select value={form.customerId} onChange={(e) => set('customerId')(e.target.value)}>
            <option value={SAME_CUSTOMER}>
              Mesmo tomador da nota-modelo{draft.customer ? ` (${draft.customer.name})` : ''}
            </option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.document})
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <Button type="submit" variant="primary" disabled={!valid}>
            Revisar
          </Button>
        </div>
      </form>
    </Layout>
  );
}

const UNCERTAIN_TEXT =
  'Não houve resposta clara. A nota pode ter sido emitida: tente de novo aqui, sem emitir outra.';

// A 4xx answer means the server refused before reserving a DPS number; anything else may have issued.
function isDefinitive(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}

interface PendingSend {
  key: string;
  form: Form;
}

function readPendingSend(storageKey: string): PendingSend | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as PendingSend) : null;
  } catch {
    return null;
  }
}

function writePendingSend(storageKey: string, value: PendingSend): void {
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
