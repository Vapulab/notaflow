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

export function welcomeEmail(name: string): RenderedMail {
  const greeting = name ? `Olá, ${name}!` : 'Olá!';
  const body = 'Sua conta no NotaFlow está pronta. Entre em https://notaflow.vapulab.com/entrar.';
  return {
    subject: 'Boas-vindas ao NotaFlow',
    text: `${greeting}\n\n${body}\n\n${FOOTER}\n`,
    html: layout(
      `<p style="margin:0 0 16px">${escapeHtml(greeting)}</p><p style="margin:0">${escapeHtml(body)}</p>`,
    ),
  };
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

function layout(content: string): string {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:${COLOR.surface};color:${COLOR.fg};font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid ${COLOR.border};border-radius:8px;padding:24px">
<p style="margin:0 0 16px;font-weight:600;font-size:18px;color:${COLOR.primary}">NotaFlow</p>
${content}
</div>
<p style="max-width:480px;margin:16px auto 0;font-size:12px;color:${COLOR.muted}">${FOOTER}</p>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
