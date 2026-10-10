import { useState } from 'react';
import { api, type Emitter, type FiscalConfig, type Service } from '../api';
import { EnvironmentBadge } from '../components/EnvironmentBadge';
import { Layout, errorText } from '../components/Layout';
import { roleIn, useMe } from '../components/MeContext';
import { useAsync } from '../components/useAsync';
import { formatServiceCode } from '../format';
import { routeHref } from '../router';
import {
  Alert,
  Badge,
  Button,
  Card,
  Link,
  SECTION_TITLE_CLASSES,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
} from '../ui';
import { FiscalConfigForm, OWNER_ONLY_TEXT } from './FiscalConfigForm';
import { ServiceDialog } from './ServiceDialog';

export function EmitterPage(props: { accountId: string; emitterId: string }) {
  const { accountId, emitterId } = props;
  const base = `/api/accounts/${encodeURIComponent(accountId)}`;
  const emitterUrl = `${base}/emitters/${encodeURIComponent(emitterId)}`;
  const emitters = useAsync(() => api.get<Emitter[]>(`${base}/emitters`), [base]);
  const fiscal = useAsync(() => api.get<FiscalConfig>(`${emitterUrl}/fiscal`), [emitterUrl]);
  const canEdit = roleIn(useMe(), accountId) === 'owner';
  const emitter = emitters.data?.find((e) => e.id === emitterId);

  return (
    <Layout title={emitter?.companyName ?? 'Emitente'} accountId={accountId}>
      <Link href={routeHref({ name: 'emitters', accountId })} variant="muted">
        Voltar para os emitentes
      </Link>
      {emitter && <EnvironmentBadge environment={emitter.environment} />}
      {!canEdit && <Alert variant="info">{OWNER_ONLY_TEXT}</Alert>}
      {fiscal.error && <Alert variant="error">{errorText(fiscal.error)}</Alert>}
      {!fiscal.data && !fiscal.error && <Spinner />}
      {fiscal.data && (
        <FiscalConfigForm url={`${emitterUrl}/fiscal`} config={fiscal.data} canEdit={canEdit} />
      )}
      <Services accountId={accountId} emitterId={emitterId} canEdit={canEdit} />
    </Layout>
  );
}

function Services(props: { accountId: string; emitterId: string; canEdit: boolean }) {
  const { accountId, emitterId, canEdit } = props;
  const base = `/api/accounts/${encodeURIComponent(accountId)}`;
  const [archived, setArchived] = useState(false);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = `${base}/emitters/${encodeURIComponent(emitterId)}/services${archived ? '?archived=1' : ''}`;
  const services = useAsync(() => api.get<Service[]>(url), [url, version]);
  const reload = () => setVersion((v) => v + 1);

  async function setArchivedOf(service: Service, value: boolean) {
    const {
      id: _id,
      emitterId: _emitter,
      origin: _origin,
      archived: _archived,
      ...input
    } = service;
    try {
      await api.put(`${base}/services/${encodeURIComponent(service.id)}`, {
        ...input,
        archived: value,
      });
      reload();
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={`${SECTION_TITLE_CLASSES} mb-0`}>Serviços</h2>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Mostrar arquivados
          </label>
          <Button variant="primary" disabled={!canEdit} onClick={() => setEditing('new')}>
            Novo serviço
          </Button>
        </div>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      {services.error && <Alert variant="error">{errorText(services.error)}</Alert>}
      {!services.data && !services.error && <Spinner />}
      {services.data && services.data.length === 0 && (
        <p className="text-sm text-muted">
          Nenhum serviço ainda. A sincronização importa os serviços das notas emitidas.
        </p>
      )}
      {services.data && services.data.length > 0 && (
        <Table>
          <THead>
            <tr>
              <TH>Nome</TH>
              <TH>Código</TH>
              <TH>Descrição</TH>
              <TH>Ações</TH>
            </tr>
          </THead>
          <TBody>
            {services.data.map((service) => (
              <tr key={service.id}>
                <TD>
                  {service.name}
                  {service.archived && <Badge variant="neutral">Arquivado</Badge>}
                </TD>
                <TD>{formatServiceCode(service.nationalTaxCode)}</TD>
                <TD className="max-w-md truncate">{service.description}</TD>
                <TD>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!canEdit}
                      onClick={() => setEditing(service)}
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!canEdit}
                      onClick={() => void setArchivedOf(service, !service.archived)}
                    >
                      {service.archived ? 'Reativar' : 'Arquivar'}
                    </Button>
                  </div>
                </TD>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      {editing && (
        <ServiceDialog
          accountId={accountId}
          emitterId={emitterId}
          service={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </Card>
  );
}
