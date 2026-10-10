import { type FormEvent, useEffect, useRef, useState } from 'react';
import { api, type Customer, type Draft, type Emitter, type ExchangeRate } from '../api';
import { EnvironmentBadge } from '../components/EnvironmentBadge';
import { IssueResultView } from '../components/IssueResultView';
import { Layout, errorText } from '../components/Layout';
import { showsEnvironment, useMe } from '../components/MeContext';
import { useAsync } from '../components/useAsync';
import { useIssueSend } from '../components/useIssueSend';
import {
  brasiliaToday,
  centsInput,
  formatCents,
  formatCompetence,
  formatDate,
  parseCents,
  previousMonthEnd,
} from '../format';
import {
  Alert,
  Button,
  CARD_CLASSES,
  Card,
  Field,
  FORM_CLASSES,
  Input,
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
  const send = useIssueSend<Form>({ accountId, storageKey });
  const [form, setForm] = useState<Form>(
    send.restored ?? {
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
  const reviewing = useRef(send.key !== null);
  reviewing.current = send.key !== null;
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
    send.startReview();
  }

  function confirm() {
    if (brlCents === null) return;
    void send.send(form, `${base}/invoices/issue`, {
      templateInvoiceId: draft.templateInvoiceId,
      competence: form.competence,
      serviceCents: brlCents,
      ...(foreignCents ? { foreignAmountCents: foreignCents } : {}),
      description: form.description.trim(),
      ...(form.customerId ? { customerId: form.customerId } : {}),
    });
  }

  if (send.result) {
    return (
      <IssueResultView
        accountId={accountId}
        title="Emitir parecida"
        environment={emitter.environment}
        send={send}
      />
    );
  }

  if (send.key) {
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
        {send.error && <Alert variant="error">{send.error}</Alert>}
        <div className="flex flex-wrap gap-3">
          <Button
            variant={production ? 'danger' : 'primary'}
            disabled={send.busy}
            onClick={confirm}
          >
            {send.locked
              ? 'Tentar de novo'
              : !namesEnvironment
                ? 'Emitir nota'
                : production
                  ? 'Emitir em PRODUÇÃO'
                  : 'Emitir em produção restrita'}
          </Button>
          {!send.locked && (
            <Button variant="secondary" disabled={send.busy} onClick={() => send.backToEdit()}>
              Voltar e editar
            </Button>
          )}
          {send.busy && <Spinner label="Emitindo" />}
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
