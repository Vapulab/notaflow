import type { ReactNode } from 'react';
import { ApiError } from '../api';
import { formatCents, formatDate } from '../format';
import { resetAnalytics } from '../analytics/analytics';
import { signOut } from '../auth/authApi';
import { navigate, routeHref, useRoute } from '../router';
import { roleIn, useMe } from './MeContext';
import { Avatar, initialsOf, linkClasses, ThemeToggle } from '../ui';

export const ERROR_TEXT: Record<string, string> = {
  unauthenticated: 'Sua sessão terminou. Entre de novo.',
  signup_closed: 'O cadastro de novas empresas abre em breve.',
  signup_limit: 'Muitos cadastros a partir desta rede hoje. Tente amanhã.',
  account_removed: 'Esta conta foi removida. Fale com o suporte.',
  rate_limited: 'Muitas tentativas. Espere um minuto e tente de novo.',
  INVALID_OTP: 'Código incorreto. Confira e tente de novo.',
  OTP_EXPIRED: 'Este código expirou. Peça um novo.',
  TOO_MANY_ATTEMPTS: 'Tentativas demais com este código. Peça um novo.',
  INVALID_EMAIL_OR_PASSWORD: 'E-mail ou senha incorretos.',
  EMAIL_NOT_VERIFIED:
    'Seu e-mail ainda não foi confirmado. Entre com um código por e-mail; ele confirma o e-mail.',
  PASSWORD_TOO_SHORT: 'A senha precisa de pelo menos 10 caracteres.',
  PASSWORD_COMPROMISED: 'Esta senha apareceu em vazamentos conhecidos. Escolha outra.',
  USER_ALREADY_EXISTS: 'Já existe uma conta com este e-mail. Entre ou redefina a senha.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    'Já existe uma conta com este e-mail. Entre ou redefina a senha.',
  MISSING_RESPONSE: 'Confirme que você não é um robô e tente de novo.',
  VERIFICATION_FAILED: 'A verificação anti-robô falhou. Tente de novo.',
  INVALID_EMAIL: 'E-mail inválido.',
  already_has_account: 'Você já participa de uma conta.',
  invalid_name: 'Digite o nome da empresa.',
  invalid_cnpj: 'O CNPJ deve ter 14 caracteres.',
  card_unreadable:
    'Não conseguimos ler este PDF. Envie o cartão baixado do site da Receita, ou digite o CNPJ.',
  card_no_cnpj: 'Este PDF não traz um CNPJ. Envie o cartão CNPJ, ou digite o CNPJ.',
  card_too_large: 'O PDF passa de 2 MB.',
  simples_revenue_missing:
    'Informe a receita bruta dos últimos 12 meses na configuração fiscal do emitente.',
  outside_simples: 'Acima de R$ 4.800.000,00 a empresa sai do Simples Nacional.',
  card_busy: 'Muitos cartões sendo lidos agora. Tente de novo em instantes.',
  too_many_lookups: 'Muitas consultas de CNPJ nesta conta. Tente de novo em uma hora.',
  cnpj_not_found: 'Este CNPJ não foi encontrado na consulta pública.',
  cnpj_not_active: 'Este CNPJ não está ativo na Receita.',
  cnpj_lookup_unavailable: 'A consulta do CNPJ não respondeu. Tente de novo em instantes.',
  certificate_cnpj_mismatch:
    'Este certificado é de outro CNPJ. Envie o certificado da empresa do cartão.',
  card_required: 'Envie o cartão CNPJ antes do certificado.',
  onboarding_step: 'Esta etapa já foi feita. Atualize a página.',
  // The browser closed or refused the passkey prompt; the cause stays in the browser.
  ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY: 'O navegador não concluiu a passkey. Tente de novo.',
  account_suspended: 'Esta conta está suspensa. Você pode consultar, mas não alterar.',
  owner_only: 'Só o dono da conta pode fazer isso.',
  cnpj_in_other_account: 'Este CNPJ já pertence a outra conta.',
  emitter_exists: 'Este emitente já está cadastrado. Use "Trocar certificado".',
  connection_test_failed: 'O teste de conexão com o sistema nacional falhou. Tente de novo.',
  WRONG_PASSWORD: 'Senha do certificado incorreta.',
  EXPIRED: 'Este certificado está vencido.',
  NOT_YET_VALID: 'Este certificado ainda não é válido.',
  INVALID_FILE: 'O arquivo não é um certificado .pfx válido.',
  CNPJ_NOT_FOUND: 'O certificado não traz um CNPJ.',
  cnpj_mismatch: 'O certificado é de outro CNPJ.',
  confirmation_required: 'Confirmação incorreta. Digite producao para confirmar.',
  sync_running: 'Uma sincronização já está em andamento.',
  invalid_access_key: 'A chave de acesso deve ter 50 caracteres.',
  emitter_not_found: 'Esta chave não é de um emitente desta conta.',
  invoice_not_found: 'Nenhuma nota encontrada com esta chave.',
  no_active_certificate: 'O emitente não tem certificado ativo.',
  user_exists: 'Já existe um usuário com este e-mail.',
  already_member: 'Esta pessoa já é membro da conta.',
  not_found: 'Não encontrado.',
  template_unsupported: 'Esta nota tem campos que o NotaFlow ainda não sabe copiar.',
  template_not_issued: 'Só uma nota emitida ou cancelada serve de modelo.',
  invalid_amount: 'Informe um valor maior que zero.',
  competence_after_issue: 'A competência não pode ser depois de hoje.',
  customer_without_document: 'Este cliente não tem CNPJ, CPF ou NIF.',
  customer_not_found: 'Cliente não encontrado.',
  not_unknown: 'Esta nota não está pendente nem incerta.',
  not_issued: 'Só uma nota emitida pode ser cancelada.',
  sefin_rejected: 'A Sefin recusou o pedido.',
  sefin_unavailable: 'A Sefin não respondeu. Tente de novo em alguns minutos.',
  ptax_unavailable:
    'Não foi possível buscar a cotação PTAX da competência. Tente de novo em alguns minutos.',
  unsupported_currency: 'Moeda sem cotação PTAX no NotaFlow. Use dólar (USD) ou euro (EUR).',
  amount_ptax_mismatch:
    'O valor em reais deve ser o valor em moeda estrangeira pela cotação PTAX de venda da data de competência. Busque a cotação de novo.',
  invalid_competence: 'A competência não é uma data válida.',
  invalid_description: 'Informe uma descrição do serviço.',
  foreign_amount_not_allowed: 'Cliente no Brasil: a nota é só em reais.',
  emitter_not_simples: 'Este emitente não é ME/EPP do Simples Nacional.',
  retention_not_allowed: 'Só um cliente pessoa jurídica no Brasil pode reter o ISS.',
  invalid_iss_rate: 'Alíquota de ISS inválida para este serviço.',
  invalid_text:
    'Há caracteres que a nota fiscal não aceita. Use só letras, números e pontuação comuns.',
  fiscal_config_missing: 'Configure o Simples e o ISS do emitente antes de emitir.',
  service_not_found: 'Serviço não encontrado.',
  customer_address_incomplete: 'O endereço do cliente está incompleto (município e CEP).',
  customer_country_missing: 'Informe o país do cliente no exterior.',
  invalid_document: 'CPF, CNPJ ou NIF inválido.',
  customer_exists: 'Já existe um cliente com este documento.',
  unknown_service_code: 'Código de serviço fora da lista nacional.',
  unknown_municipality: 'Município fora da tabela do IBGE. Escolha o município na lista.',
  unknown_country: 'País fora da tabela ISO. Escolha o país na lista.',
  legal_version_changed:
    'Os termos mudaram desde que a página abriu. Recarregue a página e leia a versão atual.',
  invalid_cep: 'O CEP deve ter 8 dígitos.',
  emitter_removed:
    'Este CNPJ pertence a um emitente removido. Fale com o suporte para restaurá-lo.',
  cannot_anonymize_self: 'Você não pode anonimizar a sua própria conta.',
  cep_not_found: 'CEP não encontrado. Preencha o endereço e escolha o município na lista.',
  cep_unavailable:
    'A consulta de CEP não respondeu. Preencha o endereço e escolha o município na lista.',
  template_unreadable: 'Não foi possível reenviar esta nota com segurança. Fale com o suporte.',
  invalid_justification: 'A justificativa precisa ter de 15 a 255 caracteres.',
  invalid_address: 'Endereço incompleto.',
  invalid_idempotency_key: 'Erro interno do formulário. Recarregue a página.',
  danfse_unavailable: 'O ADN não está gerando o PDF agora. Tente de novo em alguns minutos.',
};

export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const text = ERROR_TEXT[error.code] ?? `Erro inesperado (${error.code}).`;
    const { expectedCents, rate, rateDate } = error.body;
    if (error.code === 'amount_ptax_mismatch' && typeof expectedCents === 'number') {
      const rateText = typeof rate === 'string' ? rate.replace('.', ',') : '';
      const date = typeof rateDate === 'string' ? formatDate(`${rateDate}T12:00:00Z`) : '';
      return `${text} Valor esperado: ${formatCents(expectedCents)} (PTAX ${rateText} de ${date}).`;
    }
    if (error.code === 'cnpj_not_active' && typeof error.body.status === 'string') {
      return `Este CNPJ não está ativo na Receita (situação: ${error.body.status}).`;
    }
    if (error.code === 'invalid_iss_rate' && typeof error.body.minimum === 'string') {
      return `A alíquota mínima deste serviço é ${error.body.minimum.replace('.', ',')}%.`;
    }
    return text;
  }
  return 'Erro inesperado. Tente de novo.';
}

const SECTIONS = [
  { name: 'invoices', label: 'Notas', current: ['invoices', 'invoice', 'issue'] },
  { name: 'emitters', label: 'Emitentes', current: ['emitters'] },
  { name: 'customers', label: 'Clientes', current: ['customers', 'customer'] },
  { name: 'members', label: 'Membros', current: ['members'] },
] as const;

// Malphas Navbar and page shell, without Alpine: the links are plain paths that useRoute keeps in the app.
export function Layout(props: { title: string; accountId?: string; children: ReactNode }) {
  const route = useRoute();
  const me = useMe();
  const { accountId } = props;
  // Membros is an owner tool; the server refuses it to anyone else anyway.
  const sections = SECTIONS.filter(
    (section) => section.name !== 'members' || (accountId && roleIn(me, accountId) === 'owner'),
  );
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <a href={routeHref({ name: 'home' })} className="font-display font-semibold text-fg">
            NotaFlow
          </a>
          {accountId && (
            <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
              {sections.map((section) => {
                const current = (section.current as readonly string[]).includes(route.name);
                return (
                  <li key={section.name}>
                    <a
                      href={routeHref({ name: section.name, accountId })}
                      {...(current ? { 'aria-current': 'page' as const } : {})}
                      className={`text-sm ${current ? 'font-medium text-fg' : linkClasses({ variant: 'muted' })}`}
                    >
                      {section.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            <a href="/app?tour=1" className={`text-sm ${linkClasses({ variant: 'muted' })}`}>
              Ver o tour
            </a>
            {me && (
              <a href={routeHref({ name: 'profile' })} title="Minha conta" aria-label="Minha conta">
                <Avatar initials={initialsOf(me.name)} label={`${me.name} (${me.email})`} />
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                resetAnalytics();
                void signOut().finally(() => navigate('/entrar', { replace: true }));
              }}
              className={`text-sm ${linkClasses({ variant: 'muted' })}`}
            >
              Sair
            </button>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-6 font-display text-2xl font-semibold text-fg">{props.title}</h1>
        <div className="flex flex-col gap-6">{props.children}</div>
      </main>
    </div>
  );
}
