import { api } from '../api';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { formatDate, formatDateTime } from '../format';
import { routeHref } from '../router';
import { Alert, Badge, Card, SECTION_TITLE_CLASSES, Spinner } from '../ui';

export interface AdminBugReport {
  id: string;
  title: string;
  description: string;
  pagePath: string;
  userAgent: string | null;
  status: 'open' | 'closed';
  closedAt: string | null;
  createdAt: string;
  githubIssueUrl: string | null;
  notionPageUrl: string | null;
  accountId: string;
  accountName: string | null;
  reporterEmail: string | null;
  reporterName: string | null;
  images: { position: number; contentType: string; sizeBytes: number; purgedAt: string | null }[];
}

// Platform admins only: the server answers 403 to anyone else.
export function AdminBugPage(props: { reportId: string }) {
  const id = encodeURIComponent(props.reportId);
  const report = useAsync(() => api.get<AdminBugReport>(`/api/admin/bug-reports/${id}`), [id]);
  const data = report.data;
  const purgedAt = data?.images.find((image) => image.purgedAt)?.purgedAt ?? null;
  return (
    <Layout title="Relato de bug">
      <p>
        <a href={routeHref({ name: 'admin' })} className="text-sm text-primary">
          Voltar ao painel do administrador
        </a>
      </p>
      {report.loading && !data && <Spinner />}
      {report.error && <Alert variant="error">{errorText(report.error)}</Alert>}
      {data && (
        <>
          <Card>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className={SECTION_TITLE_CLASSES}>{data.title}</h2>
                <Badge variant={data.status === 'open' ? 'warning' : 'success'}>
                  {data.status === 'open'
                    ? 'Aberto'
                    : `Resolvido em ${formatDateTime(data.closedAt)}`}
                </Badge>
              </div>
              <p className="whitespace-pre-wrap text-sm">{data.description}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">Conta</dt>
                <dd>
                  {data.accountName ?? '(removida)'}{' '}
                  <code className="font-mono text-xs">{data.accountId}</code>
                </dd>
                <dt className="text-muted">Reportado por</dt>
                <dd>
                  {data.reporterName ?? '(removido)'}
                  {data.reporterEmail && ` <${data.reporterEmail}>`}
                </dd>
                <dt className="text-muted">Reportado em</dt>
                <dd>{formatDateTime(data.createdAt)}</dd>
                <dt className="text-muted">Tela</dt>
                <dd>
                  <code className="font-mono text-xs">{data.pagePath}</code>
                </dd>
                <dt className="text-muted">Navegador</dt>
                <dd className="text-xs">{data.userAgent ?? 'desconhecido'}</dd>
                <dt className="text-muted">Issue</dt>
                <dd>
                  {data.githubIssueUrl ? (
                    <a href={data.githubIssueUrl} target="_blank" rel="noreferrer">
                      {data.githubIssueUrl}
                    </a>
                  ) : (
                    'ainda não criada'
                  )}
                </dd>
                {data.notionPageUrl && (
                  <>
                    <dt className="text-muted">Notion</dt>
                    <dd>
                      <a href={data.notionPageUrl} target="_blank" rel="noreferrer">
                        Abrir o card
                      </a>
                    </dd>
                  </>
                )}
              </dl>
            </div>
          </Card>
          <Card>
            <h2 className={SECTION_TITLE_CLASSES}>Imagens</h2>
            {data.images.length === 0 && <p className="text-sm text-muted">Sem imagens.</p>}
            {purgedAt && (
              <p className="text-sm text-muted">
                As imagens foram apagadas em {formatDate(purgedAt)}, 30 dias depois da correção.
              </p>
            )}
            <div className="flex flex-col gap-4">
              {data.images
                .filter((image) => !image.purgedAt)
                .map((image) => {
                  const src = `/api/admin/bug-reports/${id}/images/${image.position}`;
                  return (
                    <a key={image.position} href={src} target="_blank" rel="noreferrer">
                      <img
                        src={src}
                        alt={`Imagem ${image.position} do relato`}
                        className="max-w-full rounded border border-border"
                      />
                    </a>
                  );
                })}
            </div>
          </Card>
        </>
      )}
    </Layout>
  );
}
