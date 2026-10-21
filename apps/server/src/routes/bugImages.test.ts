import { eq } from 'drizzle-orm';
import { MockAgent } from 'undici';
import { afterEach, expect, test } from 'vitest';
import { seedTenant, seedUser } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { bugReportImages, bugReports } from '../db/schema';

const R2 = {
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  R2_BUG_REPORTS_ACCESS_KEY_ID: 'r2-key-id',
  R2_BUG_REPORTS_SECRET_ACCESS_KEY: 'r2-secret',
  R2_BUG_REPORTS_BUCKET: 'bugs',
};
const CHANNELS = {
  GITHUB_BUG_TOKEN: 'test-github-token',
  GITHUB_BUG_REPO: 'Vapulab/notaflow',
  DISCORD_BUG_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc',
  NOTION_TOKEN: 'test-notion-token',
  NOTION_BUGS_DATABASE_ID: 'db1',
};
const R2_ORIGIN = 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com';
const DAY = 86400_000;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([4, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);
const png = { contentType: 'image/png', data: PNG.toString('base64') };
const webp = { contentType: 'image/webp', data: WEBP.toString('base64') };

const BUG = { title: 'Botão travou', description: 'Cliquei e nada.', pagePath: '/app/acc/notas' };

let t: TestApp | undefined;
afterEach(() => t?.close());

async function setup(env: Record<string, string> = R2) {
  const agent = new MockAgent();
  agent.disableNetConnect();
  t = await createTestApp({ bugDispatcher: agent, env });
  const app = t;
  const tenant = seedTenant(app.db, { accountName: 'Padaria Exemplo', email: 'ana@example.com' });
  seedUser(app.db, 'admin@example.com', 'admin');
  const headers = await app.as('ana@example.com');
  const r2 = agent.get(R2_ORIGIN);
  const puts: { path: string; type: string; auth: string }[] = [];
  const deletes: string[] = [];
  const answers = {
    put: (times = 1, status = 200) =>
      r2
        .intercept({ path: (path: string) => path.startsWith('/bugs/bug-reports/'), method: 'PUT' })
        .reply((request) => {
          const h = request.headers as Record<string, string>;
          puts.push({
            path: request.path,
            type: h['content-type'] ?? '',
            auth: h.authorization ?? '',
          });
          return { statusCode: status, data: '' };
        })
        .times(times),
    delete: (status = 204, times = 1) =>
      r2
        .intercept({
          path: (path: string) => path.startsWith('/bugs/bug-reports/'),
          method: 'DELETE',
        })
        .reply((request) => {
          deletes.push(request.path);
          return { statusCode: status, data: '' };
        })
        .times(times),
  };
  const report = (payload: Record<string, unknown>) =>
    app.app.inject({
      method: 'POST',
      url: `/api/accounts/${tenant.accountId}/bug-reports`,
      headers,
      payload,
    });
  const images = () =>
    app.db.select().from(bugReportImages).orderBy(bugReportImages.position).all();
  const close = (id: string, at: Date) =>
    app.db
      .update(bugReports)
      .set({ status: 'closed', closedAt: at })
      .where(eq(bugReports.id, id))
      .run();
  return { app, agent, r2, tenant, headers, puts, deletes, answers, report, images, close };
}

test('a report with two images stores them in R2 before it answers, and records one row each', async () => {
  const s = await setup();
  s.answers.put(2);
  const response = await s.report({ ...BUG, images: [webp, png] });
  expect(response.statusCode).toBe(201);
  const { id } = response.json<{ id: string }>();
  expect(s.puts.map((p) => [p.path, p.type])).toEqual([
    [`/bugs/bug-reports/${id}/1.webp`, 'image/webp'],
    [`/bugs/bug-reports/${id}/2.png`, 'image/png'],
  ]);
  expect(s.puts[0]?.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=r2-key-id\/\d{8}\/auto\/s3\//);
  expect(s.images()).toMatchObject([
    {
      bugReportId: id,
      accountId: s.tenant.accountId,
      position: 1,
      contentType: 'image/webp',
      sizeBytes: WEBP.length,
      r2Key: `bug-reports/${id}/1.webp`,
      purgedAt: null,
      createdBy: s.tenant.userId,
    },
    { position: 2, contentType: 'image/png', sizeBytes: PNG.length },
  ]);
  const audit = s.app.db.$client
    .prepare("SELECT detail FROM audit_log WHERE action = 'bug.report'")
    .get() as { detail: string };
  expect(audit.detail).toBe('2 image(s)');
  const config = await s.app.app.inject({ method: 'GET', url: '/api/public/config' });
  expect(config.json()).toMatchObject({ bugScreenshots: true });
});

test('without R2 a report with images is refused, and a text-only report still works', async () => {
  const s = await setup({});
  const refused = await s.report({ ...BUG, images: [png] });
  expect(refused.statusCode).toBe(400);
  expect(refused.json()).toMatchObject({ error: 'bug_images_unavailable' });
  expect(s.app.db.select().from(bugReports).all()).toHaveLength(0);
  expect((await s.report(BUG)).statusCode).toBe(201);
  const config = await s.app.app.inject({ method: 'GET', url: '/api/public/config' });
  expect(config.json()).toMatchObject({ bugScreenshots: false });
});

test.each([
  ['four images', { images: [png, png, png, png] }, 'bad_request'],
  ['a GIF', { images: [{ contentType: 'image/gif', data: png.data }] }, 'bad_request'],
  [
    'data that is not base64',
    { images: [{ contentType: 'image/png', data: 'not base64!' }] },
    'bad_request',
  ],
  [
    'an image over 1 MB',
    {
      images: [
        { contentType: 'image/png', data: Buffer.alloc(1024 * 1024 + 3).toString('base64') },
      ],
    },
    'bad_request',
  ],
  [
    'a PNG that says it is WebP',
    { images: [{ contentType: 'image/webp', data: png.data }] },
    'invalid_bug_image',
  ],
  [
    'a text file that says it is PNG',
    {
      images: [
        { contentType: 'image/png', data: Buffer.from('<svg onload=x>').toString('base64') },
      ],
    },
    'invalid_bug_image',
  ],
])('%s is refused before anything reaches R2', async (_name, extra, error) => {
  const s = await setup();
  const response = await s.report({ ...BUG, ...extra });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ error });
  expect(s.puts).toEqual([]);
  expect(s.app.db.select().from(bugReports).all()).toHaveLength(0);
});

test('three images of almost 1 MB each fit in the body limit', async () => {
  const s = await setup();
  s.answers.put(3);
  const big = {
    contentType: 'image/png',
    data: Buffer.concat([PNG, Buffer.alloc(1024 * 1024 - PNG.length)]).toString('base64'),
  };
  const response = await s.report({
    ...BUG,
    description: 'é'.repeat(4000),
    images: [big, big, big],
  });
  expect(response.statusCode).toBe(201);
  expect(s.images()).toHaveLength(3);
});

test('a failed upload stores no report and removes the images already sent', async () => {
  const s = await setup();
  s.answers.put(1);
  s.answers.put(1, 500);
  s.answers.delete();
  const response = await s.report({ ...BUG, images: [png, webp] });
  expect(response.statusCode).toBe(502);
  expect(response.json()).toMatchObject({ error: 'bug_images_failed' });
  expect(s.app.db.select().from(bugReports).all()).toHaveLength(0);
  expect(s.deletes).toEqual([s.puts[0]?.path]);
});

test('the deliveries count the images and link the admin page; the issue has no link', async () => {
  const s = await setup({ ...R2, ...CHANNELS });
  s.answers.put(2);
  const sent: Record<string, Record<string, unknown>> = {};
  s.agent
    .get('https://api.github.com')
    .intercept({ path: '/repos/Vapulab/notaflow/issues', method: 'POST' })
    .reply((request) => {
      sent.github = JSON.parse(String(request.body)) as Record<string, unknown>;
      return {
        statusCode: 201,
        data: { number: 1, html_url: 'https://github.com/Vapulab/notaflow/issues/1' },
      };
    });
  s.agent
    .get('https://api.notion.com')
    .intercept({ path: '/v1/pages', method: 'POST' })
    .reply((request) => {
      sent.notion = JSON.parse(String(request.body)) as Record<string, unknown>;
      return { statusCode: 200, data: { id: 'p1', url: 'https://www.notion.so/p1' } };
    });
  s.agent
    .get('https://discord.com')
    .intercept({ path: '/api/webhooks/1/abc', method: 'POST' })
    .reply((request) => {
      sent.discord = JSON.parse(String(request.body)) as Record<string, unknown>;
      return { statusCode: 204, data: '' };
    });
  const { id } = (await s.report({ ...BUG, images: [png, webp] })).json<{ id: string }>();
  await s.app.app.bugReports.idle();
  const adminUrl = `http://localhost:3000/admin/bugs/${id}`;

  const issue = String(sent.github?.body);
  expect(issue).toContain('2 screenshots, visible to the NotaFlow team.');
  expect(issue).not.toContain('/admin/');
  expect(issue).not.toContain('r2.cloudflarestorage');

  const notion = JSON.stringify(sent.notion?.children);
  expect(notion).toContain('2 imagens. ');
  expect(notion).toContain(adminUrl);
  expect(Object.keys(sent.notion?.properties ?? {})).not.toContain('Imagens');

  const embed = JSON.stringify(sent.discord?.embeds);
  expect(embed).toContain('2 imagens');
  expect(embed).toContain(adminUrl);
});

async function reportWithImages(s: Awaited<ReturnType<typeof setup>>) {
  s.answers.put(2);
  return (await s.report({ ...BUG, images: [png, webp] })).json<{ id: string }>().id;
}

test('the purge deletes the images of reports closed more than 30 days ago, once', async () => {
  const s = await setup();
  const now = new Date();
  const old = await reportWithImages(s);
  s.close(old, new Date(now.getTime() - 31 * DAY));
  const recent = await reportWithImages(s);
  s.close(recent, new Date(now.getTime() - 29 * DAY));
  const open = await reportWithImages(s);
  s.answers.delete(204);
  // A missing object counts as deleted.
  s.answers.delete(404);

  expect(await s.app.app.bugReports.purgeImages(now)).toBe(2);
  expect(s.deletes).toEqual([`/bugs/bug-reports/${old}/1.png`, `/bugs/bug-reports/${old}/2.webp`]);
  const purged = s.images().filter((image) => image.purgedAt !== null);
  expect(purged.map((image) => image.bugReportId)).toEqual([old, old]);
  expect(
    s
      .images()
      .filter((image) => [recent, open].includes(image.bugReportId))
      .every((i) => i.purgedAt === null),
  ).toBe(true);

  // The second run finds nothing: no call to R2 and no new audit entry.
  expect(await s.app.app.bugReports.purgeImages(now)).toBe(0);
  const audit = s.app.db.$client
    .prepare(
      "SELECT user_email, account_id, entity, detail FROM audit_log WHERE action = 'bug.images_purge'",
    )
    .all();
  expect(audit).toEqual([
    {
      user_email: 'system',
      account_id: s.tenant.accountId,
      entity: old,
      detail: '2 image(s) deleted from R2',
    },
  ]);
  const metrics = await s.app.app.metrics.render();
  expect(metrics).toMatch(/notaflow_bug_report_images\{state="stored"\} 4/);
  expect(metrics).toMatch(/notaflow_bug_report_images\{state="purged"\} 2/);
});

test('a reopen before the 30 days cancels the purge', async () => {
  const s = await setup();
  const id = await reportWithImages(s);
  s.close(id, new Date(Date.now() - 31 * DAY));
  s.app.db
    .update(bugReports)
    .set({ status: 'open', closedAt: null })
    .where(eq(bugReports.id, id))
    .run();
  expect(await s.app.app.bugReports.purgeImages()).toBe(0);
  expect(s.deletes).toEqual([]);
});

test('a failed delete is logged and retried on the next run', async () => {
  const s = await setup();
  const id = await reportWithImages(s);
  s.close(id, new Date(Date.now() - 31 * DAY));
  s.answers.delete(500, 2);
  expect(await s.app.app.bugReports.purgeImages()).toBe(0);
  expect(s.images().every((image) => image.purgedAt === null)).toBe(true);
  s.answers.delete(204, 2);
  expect(await s.app.app.bugReports.purgeImages()).toBe(2);
  expect(s.images().every((image) => image.purgedAt !== null)).toBe(true);
});

test('the admin sees the report and streams its images, never cached', async () => {
  const s = await setup();
  const id = await reportWithImages(s);
  const admin = await s.app.as('admin@example.com');
  const page = await s.app.app.inject({
    method: 'GET',
    url: `/api/admin/bug-reports/${id}`,
    headers: admin,
  });
  expect(page.statusCode).toBe(200);
  expect(page.json()).toMatchObject({
    id,
    title: BUG.title,
    description: BUG.description,
    accountName: 'Padaria Exemplo',
    reporterEmail: 'ana@example.com',
    pagePath: '/app/acc/notas',
    status: 'open',
    images: [
      { position: 1, contentType: 'image/png', purgedAt: null },
      { position: 2, contentType: 'image/webp', purgedAt: null },
    ],
  });
  expect(JSON.stringify(page.json())).not.toContain('r2Key');

  s.r2
    .intercept({ path: `/bugs/bug-reports/${id}/1.png`, method: 'GET' })
    .reply(200, PNG, { headers: { 'content-length': String(PNG.length) } });
  const image = await s.app.app.inject({
    method: 'GET',
    url: `/api/admin/bug-reports/${id}/images/1`,
    headers: admin,
  });
  expect(image.statusCode).toBe(200);
  expect(image.headers['content-type']).toBe('image/png');
  expect(image.headers['cache-control']).toBe('private, no-store');
  expect(image.rawPayload.equals(PNG)).toBe(true);

  for (const url of [
    `/api/admin/bug-reports/${id}/images/3`,
    `/api/admin/bug-reports/${id}/images/x`,
    '/api/admin/bug-reports/nope',
  ]) {
    const missing = await s.app.app.inject({ method: 'GET', url, headers: admin });
    expect(missing.statusCode, url).toBe(404);
  }

  const member = await s.app.app.inject({
    method: 'GET',
    url: `/api/admin/bug-reports/${id}`,
    headers: s.headers,
  });
  expect(member.statusCode).toBe(403);
  expect(member.json()).toMatchObject({ error: 'admin_only' });
});

test('after the purge the admin page shows the date, and the image answers 404', async () => {
  const s = await setup();
  const id = await reportWithImages(s);
  s.close(id, new Date(Date.now() - 31 * DAY));
  s.answers.delete(204, 2);
  await s.app.app.bugReports.purgeImages();
  const admin = await s.app.as('admin@example.com');
  const page = await s.app.app.inject({
    method: 'GET',
    url: `/api/admin/bug-reports/${id}`,
    headers: admin,
  });
  expect(
    page.json<{ images: { purgedAt: string | null }[] }>().images.every((i) => i.purgedAt),
  ).toBe(true);
  const image = await s.app.app.inject({
    method: 'GET',
    url: `/api/admin/bug-reports/${id}/images/1`,
    headers: admin,
  });
  expect(image.statusCode).toBe(404);
});
