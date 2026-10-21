import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { MockAgent } from 'undici';
import { afterEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { bugReportDeliveries, bugReports } from '../db/schema';

const CHANNELS = {
  GITHUB_BUG_TOKEN: 'test-github-token',
  GITHUB_BUG_REPO: 'Vapulab/notaflow',
  GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
  DISCORD_BUG_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc',
  NOTION_TOKEN: 'test-notion-token',
  NOTION_BUGS_DATABASE_ID: 'db1',
};
const ISSUE_URL = 'https://github.com/Vapulab/notaflow/issues/42';
const PAGE_URL = 'https://www.notion.so/page-p1';

let t: TestApp | undefined;
afterEach(() => t?.close());

interface Sent {
  github: Record<string, unknown>[];
  notion: Record<string, unknown>[];
  notionPatches: Record<string, unknown>[];
  discord: Record<string, unknown>[];
}

async function setup(
  options: { env?: Record<string, string>; status?: 'active' | 'suspended' } = {},
) {
  const agent = new MockAgent();
  agent.disableNetConnect();
  t = await createTestApp({ bugDispatcher: agent, env: options.env ?? CHANNELS });
  const app = t;
  const tenant = seedTenant(app.db, {
    accountName: 'Padaria Exemplo',
    email: 'ana@example.com',
    role: 'member',
    ...(options.status ? { status: options.status } : {}),
  });
  const headers = await app.as('ana@example.com');
  const sent: Sent = { github: [], notion: [], notionPatches: [], discord: [] };
  const json = (body: unknown) => JSON.parse(String(body)) as Record<string, unknown>;
  const answers = {
    github: (status = 201) =>
      agent
        .get('https://api.github.com')
        .intercept({
          path: '/repos/Vapulab/notaflow/issues',
          method: 'POST',
          headers: {
            authorization: 'Bearer test-github-token',
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
          },
        })
        .reply((request) => {
          sent.github.push(json(request.body));
          return { statusCode: status, data: { number: 42, html_url: ISSUE_URL } };
        }),
    notion: () =>
      agent
        .get('https://api.notion.com')
        .intercept({
          path: '/v1/pages',
          method: 'POST',
          headers: { authorization: 'Bearer test-notion-token', 'notion-version': '2022-06-28' },
        })
        .reply((request) => {
          sent.notion.push(json(request.body));
          return { statusCode: 200, data: { id: 'p1', url: PAGE_URL } };
        }),
    notionStatus: () =>
      agent
        .get('https://api.notion.com')
        .intercept({ path: '/v1/pages/p1', method: 'PATCH' })
        .reply((request) => {
          sent.notionPatches.push(json(request.body));
          return { statusCode: 200, data: { id: 'p1' } };
        }),
    discord: () =>
      agent
        .get('https://discord.com')
        .intercept({ path: '/api/webhooks/1/abc', method: 'POST' })
        .reply((request) => {
          sent.discord.push(json(request.body));
          return { statusCode: 204, data: '' };
        }),
  };
  const report = (payload: Record<string, unknown>, accountId = tenant.accountId) =>
    app.app.inject({
      method: 'POST',
      url: `/api/accounts/${accountId}/bug-reports`,
      headers: { ...headers, 'user-agent': 'Mozilla/5.0 Teste' },
      payload,
    });
  const deliveries = () =>
    app.db.select().from(bugReportDeliveries).orderBy(bugReportDeliveries.id).all();
  return { app, agent, tenant, sent, answers, report, deliveries };
}

const BUG = {
  title: 'Erro ao emitir para 12.345.678/0001-95',
  description:
    'Emiti a nota do tomador 12.345.678/0001-95 e deu erro.\nMeu e-mail é ana@example.com e o fone (43) 99999-8888.',
  pagePath: '/app/0b9e7c1a-4f7e-4d39-9a0c-2b1c3d4e5f60/notas/nova?cliente=c1',
};

test('a member reports a bug: stored at once, then an issue, a Notion card, and a Discord message', async () => {
  const s = await setup();
  s.answers.github();
  s.answers.notion();
  s.answers.discord();
  const response = await s.report(BUG);
  expect(response.statusCode).toBe(201);
  const { id } = response.json<{ id: string }>();
  await s.app.app.bugReports.idle();

  const row = s.app.db.select().from(bugReports).where(eq(bugReports.id, id)).get();
  expect(row).toMatchObject({
    accountId: s.tenant.accountId,
    createdBy: s.tenant.userId,
    status: 'open',
    pagePath: '/app/0b9e7c1a-4f7e-4d39-9a0c-2b1c3d4e5f60/notas/nova',
    userAgent: 'Mozilla/5.0 Teste',
    githubIssueNumber: 42,
    githubIssueUrl: ISSUE_URL,
    notionPageId: 'p1',
    notionPageUrl: PAGE_URL,
  });
  expect(s.deliveries().map((d) => [d.kind, d.status])).toEqual([
    ['github_issue', 'sent'],
    ['notion_page', 'sent'],
    ['discord_report', 'sent'],
  ]);

  // The public issue: masked, and nothing that names the account or the person.
  const issue = s.sent.github[0] ?? {};
  expect(issue).toMatchObject({
    title: 'Erro ao emitir para [CNPJ]',
    type: 'Bug',
    labels: ['bug'],
  });
  const body = String(issue.body);
  expect(body).toContain('`/app/:id/notas/nova`');
  expect(body).toContain('[CNPJ]');
  expect(body).toContain('[e-mail]');
  expect(body).toContain('[telefone]');
  expect(body).toContain(id);
  for (const secret of ['12.345.678', 'ana@example.com', '99999-8888', 'Padaria', 'cliente=c1']) {
    expect(body).not.toContain(secret);
  }

  // The private Notion card has everything, with the issue link.
  const card = s.sent.notion[0] ?? {};
  expect(card.parent).toEqual({ database_id: 'db1' });
  expect(card.properties).toMatchObject({
    Título: { title: [{ text: { content: BUG.title } }] },
    Status: { select: { name: 'Novo' } },
    Origem: { select: { name: 'App' } },
    Cliente: { rich_text: [{ text: { content: 'Padaria Exemplo' } }] },
    'Reportado por': { email: 'ana@example.com' },
    Tela: { url: 'http://localhost:3000/app/0b9e7c1a-4f7e-4d39-9a0c-2b1c3d4e5f60/notas/nova' },
    Issue: { url: ISSUE_URL },
    'ID NotaFlow': { rich_text: [{ text: { content: id } }] },
  });
  expect(JSON.stringify(card.children)).toContain('ana@example.com');
  expect(JSON.stringify(card.children)).toContain('Cliente avisado');

  // The private Discord channel: the account name and both links, the text still masked.
  const message = s.sent.discord[0] ?? {};
  expect(message.allowed_mentions).toEqual({ parse: [] });
  const embed = JSON.stringify(message.embeds);
  expect(embed).toContain('Padaria Exemplo');
  expect(embed).toContain(ISSUE_URL);
  expect(embed).toContain(PAGE_URL);
  expect(embed).not.toContain('ana@example.com');

  const audit = s.app.db.$client
    .prepare("SELECT user_email, account_id, entity FROM audit_log WHERE action = 'bug.report'")
    .all();
  expect(audit).toEqual([
    { user_email: 'ana@example.com', account_id: s.tenant.accountId, entity: id },
  ]);
});

test('with no channel configured, the report is only stored', async () => {
  const s = await setup({ env: {} });
  const response = await s.report(BUG);
  expect(response.statusCode).toBe(201);
  expect(s.deliveries()).toEqual([]);
});

test('a member of a suspended account can still report a bug', async () => {
  const s = await setup({ env: {}, status: 'suspended' });
  expect((await s.report(BUG)).statusCode).toBe(201);
});

test('a GitHub failure never fails the request; Discord waits for the link, then the retry sends both', async () => {
  const s = await setup();
  s.answers.github(502);
  s.answers.notion();
  const response = await s.report(BUG);
  expect(response.statusCode).toBe(201);
  await s.app.app.bugReports.idle();
  expect(s.deliveries().map((d) => [d.kind, d.status, d.attempts])).toEqual([
    ['github_issue', 'pending', 1],
    ['notion_page', 'pending', 0],
    ['discord_report', 'pending', 0],
  ]);
  expect(s.deliveries()[0]?.lastError).toContain('GitHub answered 502');

  s.answers.github();
  s.answers.discord();
  await s.app.app.bugReports.deliverDue(new Date(Date.now() + 2 * 60_000));
  expect(s.deliveries().every((d) => d.status === 'sent')).toBe(true);
  expect(JSON.stringify(s.sent.discord[0])).toContain(ISSUE_URL);
});

test('a channel that keeps failing gives up after 5 attempts, and Discord goes without the link', async () => {
  const s = await setup({ env: { ...CHANNELS, NOTION_TOKEN: '', NOTION_BUGS_DATABASE_ID: '' } });
  s.agent
    .get('https://api.github.com')
    .intercept({ path: '/repos/Vapulab/notaflow/issues', method: 'POST' })
    .reply(500, {})
    .times(5);
  s.answers.discord();
  await s.report(BUG);
  await s.app.app.bugReports.idle();
  let at = Date.now();
  for (const minutes of [1, 5, 30, 120]) {
    at += minutes * 60_000 + 1000;
    await s.app.app.bugReports.deliverDue(new Date(at));
  }
  expect(s.deliveries().map((d) => [d.kind, d.status, d.attempts])).toEqual([
    ['github_issue', 'failed', 5],
    ['discord_report', 'sent', 1],
  ]);
  expect(JSON.stringify(s.sent.discord[0])).not.toContain('github.com');
  expect(await s.app.app.metrics.render()).toMatch(
    /notaflow_bug_report_deliveries\{channel="github",state="failed"\} 1/,
  );
});

test('a person can report 5 bugs an hour, in any account', async () => {
  const s = await setup({ env: {} });
  const other = seedTenant(s.app.db, { accountName: 'Outra', email: 'ana@example.com' });
  for (let i = 0; i < 4; i += 1) expect((await s.report(BUG)).statusCode).toBe(201);
  expect((await s.report(BUG, other.accountId)).statusCode).toBe(201);
  const refused = await s.report(BUG);
  expect(refused.statusCode).toBe(429);
  expect(refused.json()).toMatchObject({ error: 'too_many_bug_reports' });
});

test.each([
  [{ ...BUG, title: 'x'.repeat(121) }, 'bad_request'],
  [{ ...BUG, description: 'x'.repeat(4001) }, 'bad_request'],
  [{ ...BUG, pagePath: 'app/notas' }, 'bad_request'],
  [{ ...BUG, title: '   ' }, 'invalid_bug_report'],
  [{ title: BUG.title, description: BUG.description }, 'bad_request'],
])('an invalid report is refused: %#', async (payload, error) => {
  const s = await setup({ env: {} });
  const response = await s.report(payload);
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ error });
});

function sign(body: string, secret = CHANNELS.GITHUB_WEBHOOK_SECRET) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function issueEvent(action: string, number = 42, repo = 'Vapulab/notaflow') {
  return JSON.stringify({ action, issue: { number }, repository: { full_name: repo } });
}

async function webhook(
  s: { app: TestApp },
  body: string,
  event = 'issues',
  signature = sign(body),
) {
  return s.app.app.inject({
    method: 'POST',
    url: '/webhooks/github',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-hub-signature-256': signature,
    },
    payload: body,
  });
}

async function reported() {
  const s = await setup();
  s.answers.github();
  s.answers.notion();
  s.answers.discord();
  const { id } = (await s.report(BUG)).json<{ id: string }>();
  await s.app.app.bugReports.idle();
  const status = () => s.app.db.select().from(bugReports).where(eq(bugReports.id, id)).get();
  return { ...s, id, status };
}

test('a closed issue resolves its report, updates the Notion card, and tells Discord', async () => {
  const s = await reported();
  s.answers.notionStatus();
  s.answers.discord();
  expect((await webhook(s, issueEvent('closed'))).statusCode).toBe(204);
  await s.app.app.bugReports.idle();
  expect(s.status()).toMatchObject({ status: 'closed', closedAt: expect.any(Date) });
  expect(s.sent.notionPatches).toEqual([
    { properties: { Status: { select: { name: 'Resolvido' } } } },
  ]);
  expect(String(s.sent.discord[1]?.content)).toBe(
    `Resolvido: Erro ao emitir para [CNPJ] ${ISSUE_URL}`,
  );

  // GitHub delivers again on a timeout: the same event changes nothing.
  expect((await webhook(s, issueEvent('closed'))).statusCode).toBe(204);
  expect(s.deliveries()).toHaveLength(5);

  s.answers.notionStatus();
  s.answers.discord();
  expect((await webhook(s, issueEvent('reopened'))).statusCode).toBe(204);
  await s.app.app.bugReports.idle();
  expect(s.status()).toMatchObject({ status: 'open', closedAt: null });
  expect(s.sent.notionPatches[1]).toEqual({
    properties: { Status: { select: { name: 'Em análise' } } },
  });
  expect(s.deliveries().every((d) => d.status === 'sent')).toBe(true);
  const audit = s.app.db.$client
    .prepare(
      "SELECT action FROM audit_log WHERE action IN ('bug.resolve', 'bug.reopen') ORDER BY id",
    )
    .all();
  expect(audit).toEqual([{ action: 'bug.resolve' }, { action: 'bug.reopen' }]);
});

test('the webhook refuses a bad signature and ignores other events, repositories, and issues', async () => {
  const s = await reported();
  const closed = issueEvent('closed');
  expect((await webhook(s, closed, 'issues', sign(closed, 'wrong'))).statusCode).toBe(401);
  expect((await webhook(s, closed, 'issues', 'sha256=00')).statusCode).toBe(401);
  expect((await webhook(s, JSON.stringify({ zen: 'hi' }), 'ping')).statusCode).toBe(204);
  expect((await webhook(s, issueEvent('closed', 42, 'Someone/else'))).statusCode).toBe(204);
  expect((await webhook(s, issueEvent('closed', 7))).statusCode).toBe(204);
  expect((await webhook(s, issueEvent('labeled'))).statusCode).toBe(204);
  expect(s.status()?.status).toBe('open');
});

test('without a webhook secret the route answers 404', async () => {
  const s = await setup({ env: {} });
  const body = issueEvent('closed');
  expect((await webhook(s, body)).statusCode).toBe(404);
});

test('the bug gauges count open and closed reports', async () => {
  const s = await setup({ env: {} });
  await s.report(BUG);
  await s.report(BUG);
  const [first] = s.app.db.select().from(bugReports).all();
  s.app.db
    .update(bugReports)
    .set({ status: 'closed' })
    .where(eq(bugReports.id, first?.id ?? ''))
    .run();
  const text = await s.app.app.metrics.render();
  expect(text).toMatch(/notaflow_bug_reports\{status="open"\} 1/);
  expect(text).toMatch(/notaflow_bug_reports\{status="closed"\} 1/);
  expect(text).toMatch(/notaflow_bug_report_deliveries\{channel="notion",state="pending"\} 0/);
});
