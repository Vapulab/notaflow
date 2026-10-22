// Inline styles with the light Malphas tokens (apps/web/src/malphas/tokens.css): mail clients drop <style>.
const COLOR = {
  primary: 'rgb(30 64 175)',
  surface: 'rgb(250 250 249)',
  fg: 'rgb(9 13 20)',
  muted: 'rgb(100 116 139)',
  border: 'rgb(226 228 232)',
};
const FOOTER = 'Este e-mail é automático e não recebe respostas.';

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

export type CodeKind = 'sign-in' | 'email-verification' | 'forget-password';

const CODE_COPY: Record<CodeKind, { subject: string; intro: string }> = {
  'sign-in': {
    subject: 'Seu código de acesso ao NotaFlow',
    intro: 'Use este código para entrar no NotaFlow:',
  },
  'email-verification': {
    subject: 'Confirme seu e-mail no NotaFlow',
    intro: 'Use este código para confirmar seu e-mail no NotaFlow:',
  },
  'forget-password': {
    subject: 'Código para redefinir sua senha',
    intro: 'Use este código para criar ou redefinir sua senha do NotaFlow:',
  },
};

export function codeEmail(kind: CodeKind, code: string): RenderedMail {
  const copy = CODE_COPY[kind];
  const after = 'O código vale por 10 minutos. Se você não pediu este código, ignore este e-mail.';
  return {
    subject: copy.subject,
    text: `${copy.intro}\n\n${code}\n\n${after}\n\n${FOOTER}\n`,
    html: layout(
      `<p style="margin:0 0 16px">${escapeHtml(copy.intro)}</p>
<p style="margin:0 0 16px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:28px;letter-spacing:6px;font-weight:600;color:${COLOR.primary}">${escapeHtml(code)}</p>
<p style="margin:0;color:${COLOR.muted}">${escapeHtml(after)}</p>`,
    ),
  };
}

const APP = 'https://notaflow.vapulab.com';

export function welcomeEmail(name: string): RenderedMail {
  const greeting = name ? `Olá, ${name}!` : 'Olá!';
  const intro =
    'Sua conta no NotaFlow está pronta. O NotaFlow emite, copia e cancela notas fiscais de serviço pelo sistema nacional, de graça.';
  const steps = [
    'Enviar o cartão CNPJ da empresa (o PDF do site da Receita Federal).',
    'Enviar o certificado digital e-CNPJ A1 (o arquivo .pfx ou .p12, com a senha).',
    'Informar a receita bruta dos últimos 12 meses, que define a alíquota do Simples.',
    'Emitir: escolher o cliente e o serviço e conferir o valor.',
  ];
  const button = { label: 'Continuar o cadastro', href: `${APP}/app` };
  return {
    subject: 'Boas-vindas ao NotaFlow: sua primeira nota em 4 passos',
    text: `${greeting}\n\n${intro}\n\nPara a primeira nota são 4 passos:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n${button.label}: ${button.href}\n\n${FOOTER}\n`,
    html: layout(
      `<p style="margin:0 0 16px">${escapeHtml(greeting)}</p>
<p style="margin:0 0 16px">${escapeHtml(intro)}</p>
<p style="margin:0 0 8px">Para a primeira nota são 4 passos:</p>
<ol style="margin:0 0 16px;padding-left:20px">${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
${buttonHtml(button)}`,
    ),
  };
}

function buttonHtml(button: { label: string; href: string }): string {
  return `<p style="margin:0 0 16px"><a href="${escapeHtml(button.href)}" style="display:inline-block;background:${COLOR.primary};color:#ffffff;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:8px">${escapeHtml(button.label)}</a></p>`;
}

export function existingAccountEmail(): RenderedMail {
  const body =
    'Alguém tentou criar uma conta no NotaFlow com este e-mail, mas ele já tem conta. Para entrar, use um código por e-mail em https://notaflow.vapulab.com/entrar. Se não foi você, ignore este e-mail.';
  return {
    subject: 'Você já tem conta no NotaFlow',
    text: `${body}\n\n${FOOTER}\n`,
    html: layout(`<p style="margin:0">${escapeHtml(body)}</p>`),
  };
}

export function inviteEmail(invite: {
  inviter: string; // the name and e-mail of who invited
  accountName: string;
  loginUrl: string;
}): RenderedMail {
  const intro = `${invite.inviter} convidou você para a conta ${invite.accountName} no NotaFlow, o app de emissão de notas fiscais de serviço.`;
  const how = `Para entrar, abra ${invite.loginUrl} e peça um código com este e-mail. Não é preciso criar senha.`;
  return {
    subject: `Convite para a conta ${invite.accountName} no NotaFlow`,
    text: `${intro}

${how}

${FOOTER}
`,
    html: layout(
      `<p style="margin:0 0 16px">${escapeHtml(intro)}</p>
<p style="margin:0 0 16px"><a href="${escapeHtml(invite.loginUrl)}" style="display:inline-block;background:${COLOR.primary};color:#ffffff;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:8px">Entrar no NotaFlow</a></p>
<p style="margin:0;color:${COLOR.muted}">${escapeHtml(how)}</p>`,
    ),
  };
}

// The release of a material change: the date the reminders start, and both texts.
export function legalChangeEmail(startDate: string): RenderedMail {
  const [year, month, day] = startDate.split('-');
  const start = `${day}/${month}/${year}`;
  const lines = [
    'Atualizamos os termos de uso e a política de privacidade do NotaFlow. O que muda:',
    `A partir de ${start}, o dono da conta pode receber lembretes por e-mail: quando o cadastro para no meio, antes da primeira nota e depois de muito tempo sem emitir. Todo lembrete tem um link para se descadastrar, e o perfil tem um interruptor para desligá-los.`,
    'Daqui para frente, só uma mudança relevante (que reduz direitos, cria um preço ou muda a finalidade do tratamento) pede um novo aceite, com 15 dias de antecedência. As outras atualizações aparecem como um aviso no app.',
    'Na próxima vez que entrar, o NotaFlow pede o seu aceite da nova versão.',
  ];
  const links = [
    ['Termos de uso', 'https://notaflow.vapulab.com/termos'],
    ['Política de privacidade', 'https://notaflow.vapulab.com/privacidade'],
  ] as const;
  return {
    subject: 'Atualizamos os termos de uso e a política de privacidade',
    text: `${lines.join('\n\n')}\n\n${links.map(([label, url]) => `${label}: ${url}`).join('\n')}\n\n${FOOTER}\n`,
    html: layout(
      `${lines.map((line) => `<p style="margin:0 0 16px">${escapeHtml(line)}</p>`).join('\n')}
<p style="margin:0">${links.map(([label, url]) => `<a href="${url}" style="color:${COLOR.primary}">${label}</a>`).join(' · ')}</p>`,
    ),
  };
}

function layout(content: string, footerHtml: string = FOOTER): string {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:${COLOR.surface};color:${COLOR.fg};font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid ${COLOR.border};border-radius:8px;padding:24px">
<p style="margin:0 0 16px;font-weight:600;font-size:18px;color:${COLOR.primary}">NotaFlow</p>
${content}
</div>
<p style="max-width:480px;margin:16px auto 0;font-size:12px;color:${COLOR.muted}">${footerHtml}</p>
</body></html>`;
}

// Escapes the text and turns each https:// URL in it into a link.
function linkUrls(text: string): string {
  return text
    .split(/(https:\/\/\S+)/)
    .map((part, i) =>
      i % 2 === 1
        ? `<a href="${escapeHtml(part)}" style="color:${COLOR.primary}">${escapeHtml(part)}</a>`
        : escapeHtml(part),
    )
    .join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type LifecyclePhase = 'activation' | 'first_invoice' | 'reactivation';
type LifecycleVariant = '' | 'card' | 'certificate' | 'fiscal' | 'finish';

interface ReminderCopy {
  subject: string;
  paragraphs: string[];
  button: { label: string; path: string };
}

const CARD_SOURCE =
  'É o Comprovante de Inscrição e de Situação Cadastral, que você baixa em PDF no site da Receita Federal (solucoes.receita.fazenda.gov.br). O NotaFlow lê a razão social, o endereço e as atividades sozinho, e você só confere.';

// The copy of RFC_LIFECYCLE_EMAILS, by phase, variant, and step; {account} becomes the account id.
function reminderCopy(phase: LifecyclePhase, step: 1 | 2, variant: LifecycleVariant): ReminderCopy {
  const onboarding = { label: 'Continuar o cadastro', path: '/app/comecar/{account}' };
  const newInvoice = { label: 'Emitir uma nota', path: '/app/{account}/notas/nova' };
  if (phase === 'activation' && variant === 'certificate') {
    return step === 1
      ? {
          subject: 'Falta o certificado digital A1',
          paragraphs: [
            'Seu cadastro no NotaFlow está quase pronto: falta o certificado digital da empresa.',
            'O NotaFlow usa o e-CNPJ do tipo A1, um arquivo .pfx ou .p12 com senha, para assinar as notas no sistema nacional. Se a empresa ainda não tem um, ele é comprado em uma autoridade certificadora credenciada na ICP-Brasil. O certificado A3, em cartão ou token, não funciona em um serviço on-line.',
            'O arquivo e a senha ficam cifrados e só são usados para assinar as suas notas.',
            `Como conseguir o certificado: ${APP}/guia/certificado-digital`,
          ],
          button: { label: 'Enviar o certificado', path: onboarding.path },
        }
      : {
          subject: 'Seu certificado A1 já chegou?',
          paragraphs: [
            'Seu cadastro no NotaFlow está esperando o certificado digital A1 da empresa.',
            'Quando ele chegar, é só enviar o arquivo .pfx ou .p12 e a senha para terminar o cadastro e emitir a primeira nota.',
            `Se tiver dúvida sobre qual certificado comprar, leia ${APP}/guia/certificado-digital ou responda este e-mail: quem responde é uma pessoa.`,
          ],
          button: { label: 'Enviar o certificado', path: onboarding.path },
        };
  }
  if (phase === 'activation' && variant === 'finish') {
    return step === 1
      ? {
          subject: 'Falta só concluir o cadastro',
          paragraphs: [
            'O cadastro da sua empresa no NotaFlow está quase pronto: o cartão CNPJ, o certificado e a receita já estão lá.',
            'Falta só abrir o NotaFlow e concluir. Nesse passo ele busca no sistema nacional as notas que a sua empresa já emitiu e cadastra os clientes delas, e a emissão fica liberada.',
          ],
          button: { label: 'Concluir o cadastro', path: onboarding.path },
        }
      : {
          subject: 'Sua conta está a um passo de emitir',
          paragraphs: [
            'Tudo o que o NotaFlow precisa da sua empresa já foi enviado. Falta só concluir o cadastro, e a primeira nota pode sair em seguida.',
            'Se algo travou nesse último passo, responda este e-mail com o que aconteceu: quem responde é uma pessoa.',
          ],
          button: { label: 'Concluir o cadastro', path: onboarding.path },
        };
  }
  if (phase === 'activation' && variant === 'fiscal') {
    return step === 1
      ? {
          subject: 'Último passo: a receita dos últimos 12 meses',
          paragraphs: [
            'Falta um passo no seu cadastro: informar a receita bruta da empresa nos últimos 12 meses.',
            'Ela define a faixa e a alíquota do Simples Nacional de cada nota. O NotaFlow faz a conta pelas tabelas da lei, e você não precisa calcular nada. O valor está no extrato do Simples (PGDAS-D) do último mês, ou com a sua contabilidade.',
          ],
          button: { label: 'Informar a receita', path: onboarding.path },
        }
      : {
          subject: 'Sua conta está quase pronta',
          paragraphs: [
            'Só falta a receita bruta dos últimos 12 meses para o NotaFlow calcular a alíquota das suas notas.',
            'Leva um minuto. Se não souber o valor, a sua contabilidade sabe, ou ele está no extrato do Simples do último mês. Qualquer dúvida, responda este e-mail.',
          ],
          button: { label: 'Informar a receita', path: onboarding.path },
        };
  }
  if (phase === 'activation') {
    return step === 1
      ? {
          subject: 'Falta só o cartão CNPJ',
          paragraphs: [
            'Sua conta no NotaFlow está criada, e o próximo passo é enviar o cartão CNPJ da empresa.',
            CARD_SOURCE,
            'Depois vêm o certificado A1 e a receita dos últimos 12 meses, e a primeira nota sai em seguida.',
          ],
          button: { label: 'Enviar o cartão CNPJ', path: onboarding.path },
        }
      : {
          subject: 'Precisa de ajuda com o cadastro?',
          paragraphs: [
            'Seu cadastro no NotaFlow parou no cartão CNPJ. Se travou em alguma coisa, responda este e-mail com a sua dúvida: quem responde é uma pessoa.',
            'O cartão CNPJ é o comprovante em PDF do site da Receita Federal. O NotaFlow lê os dados dele, e você só confere.',
          ],
          button: onboarding,
        };
  }
  if (phase === 'first_invoice') {
    return step === 1
      ? {
          subject: 'Tudo pronto para a sua primeira nota',
          paragraphs: [
            'O cadastro da sua empresa no NotaFlow está completo. Agora é só emitir.',
            'Escolha o cliente e o serviço e confira o valor. O NotaFlow calcula a alíquota, assina com o seu certificado, envia ao sistema nacional e devolve a chave de acesso.',
            'Se você já emitia pelo portal, as suas notas antigas foram importadas, e dá para usar "Emitir parecida" a partir de uma delas.',
          ],
          button: { label: 'Emitir a primeira nota', path: newInvoice.path },
        }
      : {
          subject: 'Sua primeira nota pelo NotaFlow',
          paragraphs: [
            'Sua conta está pronta, mas ainda não emitiu nenhuma nota pelo NotaFlow.',
            'Para um cliente no exterior, o NotaFlow converte o valor em dólar ou euro pela PTAX do Banco Central, sem conta manual. Para um cliente no Brasil, a alíquota do Simples já vem calculada.',
            'Se algo travou, responda este e-mail.',
          ],
          button: { label: 'Emitir a primeira nota', path: newInvoice.path },
        };
  }
  return step === 1
    ? {
        subject: 'Suas notas continuam aqui',
        paragraphs: [
          'Faz um tempo que a sua empresa não emite notas pelo NotaFlow.',
          'Quando precisar, ele continua pronto: a alíquota do Simples calculada pela lei, "Emitir parecida" para repetir uma nota em segundos, e o cancelamento com registro. Tudo grátis.',
        ],
        button: newInvoice,
      }
    : {
        subject: 'Ainda emitindo notas de serviço?',
        paragraphs: [
          'Este é o último lembrete: faz três meses que a sua empresa não emite notas pelo NotaFlow.',
          'Se ele não atendeu ao que você precisava, conte para a gente o porquê respondendo este e-mail. Toda resposta é lida e ajuda a melhorar o produto.',
          'Se quiser voltar, as suas notas e os seus clientes continuam aqui.',
        ],
        button: { label: 'Entrar no NotaFlow', path: '/app' },
      };
}

export function lifecycleEmail(input: {
  phase: LifecyclePhase;
  step: 1 | 2;
  variant: LifecycleVariant;
  name: string;
  accountId: string;
  unsubscribeUrl: string;
}): RenderedMail & { replyTo: string; headers: Record<string, string> } {
  const copy = reminderCopy(input.phase, input.step, input.variant);
  const greeting = input.name ? `Olá, ${input.name}!` : 'Olá!';
  const href = `${APP}${copy.button.path.replace('{account}', encodeURIComponent(input.accountId))}`;
  const footer =
    'Você recebe este lembrete porque criou uma conta no NotaFlow. Dúvidas? Responda este e-mail.';
  const stop = 'Não quer mais receber lembretes?';
  return {
    subject: copy.subject,
    replyTo: 'contato@vapulab.com',
    headers: {
      'List-Unsubscribe': `<${input.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    text: `${greeting}\n\n${copy.paragraphs.join('\n\n')}\n\n${copy.button.label}: ${href}\n\n${footer}\n${stop} ${input.unsubscribeUrl}\n`,
    html: layout(
      `<p style="margin:0 0 16px">${escapeHtml(greeting)}</p>
${copy.paragraphs.map((p) => `<p style="margin:0 0 16px">${linkUrls(p)}</p>`).join('\n')}
${buttonHtml({ label: copy.button.label, href })}`,
      `${escapeHtml(footer)} ${escapeHtml(stop)} <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${COLOR.muted}">Descadastrar</a>`,
    ),
  };
}
