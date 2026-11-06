import { monthPeriod, periodLabel } from '@notaflow/invoice-report/period';
import { useState } from 'react';
import { ApiError, api, type Emitter, type ReportStatus, type ReportView } from '../api';
import { ERROR_TEXT, Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { usePolling } from '../components/usePolling';
import { downloadFile } from '../download';
import { brasiliaToday, formatDateTime } from '../format';
import {
  Alert,
  Badge,
  Button,
  Card,
  DateInput,
  Field,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  type BadgeVariant,
} from '../ui';

const PAGE = 20;

type Mode = 'month' | 'year' | 'range';

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'month', label: 'Mensal' },
  { mode: 'year', label: 'Anual' },
  { mode: 'range', label: 'Por período' },
];

const STATUS: Record<ReportStatus, { text: string; variant: BadgeVariant }> = {
  pending: { text: 'Na fila', variant: 'info' },
  running: { text: 'Gerando…', variant: 'info' },
  ready: { text: 'Pronto', variant: 'success' },
  failed: { text: 'Falhou', variant: 'danger' },
  expired: { text: 'Expirado', variant: 'neutral' },
};

// Messages that differ from the same code elsewhere in the app.
const REPORT_ERROR_TEXT: Record<string, string> = {
  report_too_large: 'O período tem mais de 20.000 notas. Escolha um período menor.',
  too_many_requests: 'Limite de 10 relatórios por hora. Tente de novo mais tarde.',
  period_too_long: 'O período pode ter no máximo 366 dias.',
  emitter_removed: 'O emitente foi removido. Gere um relatório de outro emitente.',
  report_expired: 'Este relatório expirou. Gere de novo.',
  reports_unavailable: ERROR_TEXT.internal_error ?? '',
};

function reportErrorText(error: unknown): string {
  if (error instanceof ApiError) return REPORT_ERROR_TEXT[error.code] ?? errorText(error);
  return errorText(error);
}

// The last 24 months, newest first, as YYYY-MM.
function recentMonths(today: string): string[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: 24 }, (_, i) =>
    new Date(Date.UTC(year, month - i, 1)).toISOString().slice(0, 7),
  );
}

// "dd/mm hh:mm" in Brasília time.
const shortDateTime = (value: string) => formatDateTime(value).replace(/\/\d{4}/, '');

export function ReportsPage({ accountId }: { accountId: string }) {
  const base = `/api/accounts/${encodeURIComponent(accountId)}`;
  const today = brasiliaToday();
  const months = recentMonths(today);
  const thisYear = Number(today.slice(0, 4));
  const [emitterId, setEmitterId] = useState('');
  const [mode, setMode] = useState<Mode>('month');
  const [month, setMonth] = useState(months[1] ?? '');
  const [year, setYear] = useState(thisYear);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emitters = useAsync(() => api.get<Emitter[]>(`${base}/emitters`), [base]);
  const list = useAsync(
    () => api.get<{ reports: ReportView[]; total: number }>(`${base}/reports?offset=${offset}`),
    [base, offset],
  );
  const reports = list.data?.reports ?? [];
  const hasOpen = reports.some((r) => r.status === 'pending' || r.status === 'running');
  usePolling(hasOpen, list.reload, list.loading);

  const selectedEmitter = emitterId || emitters.data?.[0]?.id || '';
  const canCreate =
    selectedEmitter !== '' && !creating && (mode !== 'range' || (from !== '' && to !== ''));

  async function create() {
    setError(null);
    setCreating(true);
    const body =
      mode === 'month'
        ? { period: 'month', month }
        : mode === 'year'
          ? { period: 'year', year }
          : { period: 'range', from, to };
    try {
      await api.post(`${base}/reports`, { emitterId: selectedEmitter, ...body });
      if (offset === 0) list.reload();
      else setOffset(0);
    } catch (e) {
      setError(reportErrorText(e));
    } finally {
      setCreating(false);
    }
  }

  async function retry(id: string) {
    setError(null);
    try {
      await api.post(`${base}/reports/${encodeURIComponent(id)}/retry`, {});
      list.reload();
    } catch (e) {
      setError(reportErrorText(e));
    }
  }

  async function download(id: string) {
    setError(null);
    try {
      await downloadFile(`${base}/reports/${encodeURIComponent(id)}/pdf`);
    } catch (e) {
      setError(reportErrorText(e));
      list.reload();
    }
  }

  return (
    <Layout title="Relatórios" accountId={accountId}>
      <Card className="flex flex-wrap items-end gap-4">
        <Field label="Emitente">
          <Select value={selectedEmitter} onChange={(e) => setEmitterId(e.target.value)}>
            {emitters.data?.map((emitter) => (
              <option key={emitter.id} value={emitter.id}>
                {emitter.companyName}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-fg">Período</span>
          <div className="flex gap-1">
            {MODES.map((option) => (
              <Button
                key={option.mode}
                type="button"
                variant={mode === option.mode ? 'primary' : 'secondary'}
                aria-pressed={mode === option.mode}
                onClick={() => setMode(option.mode)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
        {mode === 'month' && (
          <Field label="Mês de competência">
            <Select value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((value) => (
                <option key={value} value={value}>
                  {periodLabel(monthPeriod(value))}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {mode === 'year' && (
          <Field label="Ano">
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {Array.from({ length: 6 }, (_, i) => thisYear - i).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {mode === 'range' && (
          <>
            <Field label="De">
              <DateInput value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Até">
              <DateInput value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </>
        )}
        <Button
          type="button"
          variant="primary"
          className="sm:ml-auto"
          disabled={!canCreate}
          onClick={() => void create()}
        >
          {creating ? 'Gerando…' : 'Gerar PDF'}
        </Button>
      </Card>
      {error && <Alert variant="error">{error}</Alert>}
      {list.error && <Alert variant="error">{errorText(list.error)}</Alert>}
      {list.data && (
        <>
          <Table>
            <THead>
              <tr>
                <TH>Emitente</TH>
                <TH>Período</TH>
                <TH>Pedido por</TH>
                <TH>Notas</TH>
                <TH>Situação</TH>
                <TH>
                  <span className="sr-only">Ações</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {reports.map((report) => {
                const status = STATUS[report.status];
                return (
                  <tr key={report.id}>
                    <TD>{report.emitterName}</TD>
                    <TD>{periodLabel(report.period)}</TD>
                    <TD>{`${report.createdByName ?? '-'} · ${shortDateTime(report.createdAt)}`}</TD>
                    <TD>{report.invoiceCount ?? '-'}</TD>
                    <TD>
                      <Badge variant={status.variant}>{status.text}</Badge>
                    </TD>
                    <TD>
                      {report.status === 'ready' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void download(report.id)}
                        >
                          Baixar
                        </Button>
                      )}
                      {report.status === 'failed' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void retry(report.id)}
                        >
                          Tentar de novo
                        </Button>
                      )}
                    </TD>
                  </tr>
                );
              })}
            </TBody>
          </Table>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
            <span>{list.data.total} relatórios.</span>
            {offset > 0 && (
              <Button size="sm" variant="secondary" onClick={() => setOffset(offset - PAGE)}>
                Anteriores
              </Button>
            )}
            {offset + PAGE < list.data.total && (
              <Button size="sm" variant="secondary" onClick={() => setOffset(offset + PAGE)}>
                Próximas
              </Button>
            )}
          </div>
        </>
      )}
    </Layout>
  );
}
