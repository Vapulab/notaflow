import { type FormEvent, useState } from 'react';
import { api, type Emitter, type InvoicePage, type InvoiceSummary } from '../api';
import { Layout, errorText } from '../components/Layout';
import { PdfButton } from '../components/PdfButton';
import { SendInvoiceEmail } from '../components/SendInvoiceEmail';
import { ShareInvoice } from '../components/ShareInvoice';
import { useAsync } from '../components/useAsync';
import { useIsPhone } from '../components/useMediaQuery';
import { usePolling } from '../components/usePolling';
import { formatCents, formatCompetence } from '../format';
import { downloadFile } from '../download';
import { navigate, routeHref } from '../router';
import {
  Alert,
  Badge,
  Button,
  buttonClasses,
  ButtonLink,
  Card,
  CARD_CLASSES,
  DateInput,
  Field,
  Input,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  type BadgeVariant,
} from '../ui';

export const STATUS_TEXT: Record<string, string> = {
  pending: 'Pendente',
  issued: 'Emitida',
  rejected: 'Rejeitada',
  unknown: 'Incerta',
  cancelled: 'Cancelada',
};

export const STATUS_VARIANT: Record<InvoiceSummary['status'], BadgeVariant> = {
  pending: 'info',
  issued: 'success',
  rejected: 'danger',
  unknown: 'warning',
  cancelled: 'neutral',
};

const PAGE = 50;

type Filters = {
  emitterId: string;
  status: string;
  competenceFrom: string;
  competenceTo: string;
  q: string;
};

export function InvoicesPage({ accountId }: { accountId: string }) {
  const base = `/api/accounts/${encodeURIComponent(accountId)}`;
  const [filters, setFilters] = useState<Filters>({
    emitterId: '',
    status: '',
    competenceFrom: '',
    competenceTo: '',
    q: '',
  });
  const [offset, setOffset] = useState(0);
  const [accessKey, setAccessKey] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [emailing, setEmailing] = useState<InvoiceSummary | null>(null);
  const emitters = useAsync(() => api.get<Emitter[]>(`${base}/emitters`), [base]);
  const query = new URLSearchParams(
    Object.entries({ ...filters, limit: String(PAGE), offset: String(offset) }).filter(
      ([, value]) => value !== '',
    ),
  ).toString();
  const page = useAsync(() => api.get<InvoicePage>(`${base}/invoices?${query}`), [base, query]);

  // Refetch the current page while a visible row waits for its PDF.
  const waitingForPdf =
    page.data?.items.some(
      (i) => i.pdfStatus === 'pending' && (i.status === 'issued' || i.status === 'cancelled'),
    ) ?? false;
  usePolling(waitingForPdf, page.reload, page.loading);

  async function lookup(event: FormEvent) {
    event.preventDefault();
    setLookupError(null);
    try {
      const { id } = await api.post<{ id: string }>(`${base}/invoices/lookup`, {
        accessKey: accessKey.trim(),
      });
      navigate({ name: 'invoice', accountId, invoiceId: id });
    } catch (error) {
      setLookupError(errorText(error));
    }
  }

  async function downloadPdf(invoiceId: string) {
    setPdfError(null);
    try {
      await downloadFile(`${base}/invoices/${encodeURIComponent(invoiceId)}/danfse`);
    } catch (error) {
      setPdfError(errorText(error));
    }
  }

  const phone = useIsPhone();
  const emitterName = (id: string) => emitters.data?.find((e) => e.id === id)?.companyName;

  function actionsOf(invoice: InvoiceSummary, className: string) {
    if (invoice.status !== 'issued' && invoice.status !== 'cancelled') return null;
    const emitter = emitterName(invoice.emitterId);
    return (
      // The actions act on their own; a click on them must not open the invoice.
      <div
        className={className}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <PdfButton
          variant="icon"
          status={invoice.pdfStatus}
          label="Baixar PDF"
          onDownload={() => void downloadPdf(invoice.id)}
        />
        {emitter && (
          <ShareInvoice
            variant="icon"
            accountId={accountId}
            invoiceId={invoice.id}
            number={invoice.number}
            emitterName={emitter}
            onNotaflowEmail={() => setEmailing(invoice)}
          />
        )}
        <a
          href={routeHref({ name: 'issue', accountId, invoiceId: invoice.id })}
          className={`${buttonClasses({ variant: 'primary', size: 'action' })} ml-auto`}
        >
          Emitir parecida
        </a>
      </div>
    );
  }

  const statusBadges = (invoice: InvoiceSummary) => (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant={STATUS_VARIANT[invoice.status]}>{STATUS_TEXT[invoice.status]}</Badge>
      {invoice.environment === 'producao_restrita' && (
        <Badge variant="warning" outline>
          Teste
        </Badge>
      )}
    </div>
  );

  const openInvoice = (invoice: InvoiceSummary) =>
    navigate({ name: 'invoice', accountId, invoiceId: invoice.id });

  const set = (field: keyof Filters) => (value: string) => {
    setOffset(0);
    setFilters((previous) => ({ ...previous, [field]: value }));
  };

  return (
    <Layout title="Notas" accountId={accountId}>
      <div>
        <ButtonLink variant="primary" href={routeHref({ name: 'newInvoice', accountId })}>
          Nova nota
        </ButtonLink>
      </div>
      <form
        onSubmit={lookup}
        className={`${CARD_CLASSES} flex flex-col gap-3 sm:flex-row sm:items-end`}
      >
        <div className="flex-1">
          <Field label="Buscar por chave de acesso">
            <Input value={accessKey} onChange={(e) => setAccessKey(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
      </form>
      {lookupError && <Alert variant="error">{lookupError}</Alert>}
      <Card className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select
          aria-label="Emitente"
          value={filters.emitterId}
          onChange={(e) => set('emitterId')(e.target.value)}
        >
          <option value="">Todos os emitentes</option>
          {emitters.data?.map((emitter) => (
            <option key={emitter.id} value={emitter.id}>
              {emitter.companyName}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Situação"
          value={filters.status}
          onChange={(e) => set('status')(e.target.value)}
        >
          <option value="">Todas as situações</option>
          {Object.entries(STATUS_TEXT).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </Select>
        <Field label="Competência de">
          <DateInput
            value={filters.competenceFrom}
            onChange={(e) => set('competenceFrom')(e.target.value)}
          />
        </Field>
        <Field label="Competência até">
          <DateInput
            value={filters.competenceTo}
            onChange={(e) => set('competenceTo')(e.target.value)}
          />
        </Field>
        <Input
          aria-label="Pesquisar"
          placeholder="Número ou tomador"
          value={filters.q}
          onChange={(e) => set('q')(e.target.value)}
        />
      </Card>
      {page.error && <Alert variant="error">{errorText(page.error)}</Alert>}
      {pdfError && <Alert variant="warning">{pdfError}</Alert>}
      {page.data && (
        <>
          {phone ? (
            <ul className="flex flex-col gap-3">
              {page.data.items.map((invoice) => (
                <li
                  key={invoice.id}
                  tabIndex={0}
                  aria-label={`Abrir a NFS-e ${invoice.number ?? ''} de ${invoice.customerName ?? ''}`}
                  className="cursor-pointer rounded border border-border bg-surface p-3 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  onClick={() => openInvoice(invoice)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && event.target === event.currentTarget)
                      openInvoice(invoice);
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-words font-semibold text-fg">
                        {invoice.customerName}
                      </div>
                      <div className="mt-0.5 text-xs text-muted">
                        Nº {invoice.number ?? '-'} · Competência{' '}
                        {formatCompetence(invoice.competence)}
                      </div>
                    </div>
                    <div className="whitespace-nowrap font-semibold text-fg">
                      {formatCents(invoice.serviceCents)}
                    </div>
                  </div>
                  <div className="mt-2">{statusBadges(invoice)}</div>
                  {actionsOf(
                    invoice,
                    'mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3',
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Competência</TH>
                  <TH>Tomador</TH>
                  <TH>Valor</TH>
                  <TH>Situação</TH>
                  <TH>Ações</TH>
                </tr>
              </THead>
              <TBody>
                {page.data.items.map((invoice) => {
                  const open = () => openInvoice(invoice);
                  return (
                    <tr
                      key={invoice.id}
                      tabIndex={0}
                      aria-label={`Abrir a NFS-e ${invoice.number ?? ''} de ${invoice.customerName ?? ''}`}
                      className="cursor-pointer hover:bg-muted/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      onClick={open}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && event.target === event.currentTarget) open();
                      }}
                    >
                      <TD>{formatCompetence(invoice.competence)}</TD>
                      <TD>{invoice.customerName}</TD>
                      <TD className="whitespace-nowrap">{formatCents(invoice.serviceCents)}</TD>
                      <TD>{statusBadges(invoice)}</TD>
                      <TD>{actionsOf(invoice, 'flex flex-nowrap items-center gap-1.5')}</TD>
                    </tr>
                  );
                })}
              </TBody>
            </Table>
          )}
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
            <span>{page.data.total} notas.</span>
            {offset > 0 && (
              <Button size="sm" variant="secondary" onClick={() => setOffset(offset - PAGE)}>
                Anteriores
              </Button>
            )}
            {offset + PAGE < page.data.total && (
              <Button size="sm" variant="secondary" onClick={() => setOffset(offset + PAGE)}>
                Próximas
              </Button>
            )}
          </div>
        </>
      )}
      {emailing && (
        <SendInvoiceEmail
          open
          accountId={accountId}
          invoiceId={emailing.id}
          number={emailing.number}
          onClose={() => setEmailing(null)}
        />
      )}
    </Layout>
  );
}
