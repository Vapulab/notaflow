import { type Dispatcher, request } from 'undici';

const TIMEOUT_MS = 15_000;
const USER_AGENT = 'NotaFlow bug reports';

export type NotionStatus = 'Novo' | 'Em análise' | 'Resolvido';

export interface NotionCard {
  title: string;
  description: string;
  accountName: string;
  reporterEmail: string | null;
  screenUrl: string;
  issueUrl: string | null;
  reportedAt: Date;
  reportId: string;
  // The admin page of the report, where the team sees the screenshots.
  adminUrl: string;
  imageCount: number;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
}

// The three outbound calls; each throws on a failed answer so the delivery retries.
export interface BugChannelClients {
  createIssue(issue: { title: string; body: string }): Promise<{ number: number; url: string }>;
  // A retry looks first: the answer of a create that worked may have been lost.
  findIssue(reportId: string): Promise<{ number: number; url: string } | null>;
  postDiscord(message: { content: string; embed?: DiscordEmbed }): Promise<void>;
  createNotionPage(card: NotionCard): Promise<{ id: string; url: string }>;
  findNotionPage(reportId: string): Promise<{ id: string; url: string } | null>;
  setNotionStatus(pageId: string, status: NotionStatus): Promise<void>;
}

export interface ChannelSettings {
  github: { token: string; repo: string } | null;
  discordWebhookUrl: string | null;
  notion: { token: string; databaseId: string } | null;
}

async function call(
  name: string,
  url: string,
  init: { method: 'GET' | 'POST' | 'PATCH'; headers: Record<string, string>; body?: unknown },
  dispatcher: Dispatcher | undefined,
): Promise<unknown> {
  const response = await request(url, {
    method: init.method,
    headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT, ...init.headers },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headersTimeout: TIMEOUT_MS,
    bodyTimeout: TIMEOUT_MS,
    ...(dispatcher ? { dispatcher } : {}),
  });
  if (response.statusCode >= 300) {
    // The answer body names the cause (a missing scope, a renamed property), never a secret of ours.
    const detail = (await response.body.text()).slice(0, 300);
    throw new Error(`${name} answered ${response.statusCode}: ${detail}`);
  }
  if (response.statusCode === 204) {
    await response.body.dump();
    return null;
  }
  return response.body.json();
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

// Notion refuses a rich text item over 2000 characters.
export function chunks(text: string, size = 2000): string[] {
  const parts: string[] = [];
  for (let at = 0; at < text.length; at += size) parts.push(text.slice(at, at + size));
  return parts.length > 0 ? parts : [''];
}

const richText = (text: string) => chunks(text).map((content) => ({ text: { content } }));
const heading = (text: string) => ({
  object: 'block',
  type: 'heading_2',
  heading_2: { rich_text: richText(text) },
});
const paragraph = (text: string) => ({
  object: 'block',
  type: 'paragraph',
  paragraph: { rich_text: text ? richText(text) : [] },
});
const link = (lead: string, text: string, url: string) => ({
  object: 'block',
  type: 'paragraph',
  paragraph: {
    rich_text: [
      ...(lead ? [{ text: { content: lead } }] : []),
      { text: { content: text, link: { url } } },
    ],
  },
});
const todo = (text: string) => ({
  object: 'block',
  type: 'to_do',
  to_do: { rich_text: richText(text), checked: false },
});

export const imagesText = (count: number) => `${count} ${count === 1 ? 'imagem' : 'imagens'}`;

// The line of the issue body that names the report, so a retry can find an issue it already opened.
export const reportLine = (reportId: string) => `NotaFlow report: \`${reportId}\``;

export function notionPageBody(databaseId: string, card: NotionCard) {
  return {
    parent: { database_id: databaseId },
    properties: {
      Título: { title: richText(card.title) },
      Status: { select: { name: 'Novo' } },
      Origem: { select: { name: 'App' } },
      Cliente: { rich_text: richText(card.accountName) },
      'Reportado por': { email: card.reporterEmail },
      Tela: { url: card.screenUrl },
      Issue: { url: card.issueUrl },
      'Reportado em': { date: { start: card.reportedAt.toISOString() } },
      'ID NotaFlow': { rich_text: richText(card.reportId) },
    },
    children: [
      heading('O que aconteceu'),
      paragraph(card.description),
      link(
        card.imageCount > 0 ? `${imagesText(card.imageCount)}. ` : '',
        'Abrir no painel do NotaFlow',
        card.adminUrl,
      ),
      heading('Passos para reproduzir'),
      paragraph(''),
      heading('Diagnóstico'),
      paragraph(''),
      heading('Correção'),
      todo('Teste que reproduz o bug'),
      todo('Correção no PR'),
      todo('Cliente avisado'),
    ],
  };
}

export function bugChannelClients(
  settings: ChannelSettings,
  dispatcher?: Dispatcher,
): BugChannelClients {
  const notionHeaders = (token: string) => ({
    authorization: `Bearer ${token}`,
    'notion-version': '2022-06-28',
  });
  return {
    async createIssue(issue) {
      const github = settings.github;
      if (!github) throw new Error('GitHub is not configured');
      const answer = await call(
        'GitHub',
        `https://api.github.com/repos/${github.repo}/issues`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${github.token}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
          },
          body: { ...issue, type: 'Bug', labels: ['bug'] },
        },
        dispatcher,
      );
      const number = field(answer, 'number');
      const url = field(answer, 'html_url');
      if (typeof number !== 'number' || typeof url !== 'string') {
        throw new Error('GitHub answered without an issue number');
      }
      return { number, url };
    },
    async findIssue(reportId) {
      const github = settings.github;
      if (!github) throw new Error('GitHub is not configured');
      const answer = await call(
        'GitHub',
        `https://api.github.com/repos/${github.repo}/issues?state=all&labels=bug&sort=created&direction=desc&per_page=100`,
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${github.token}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
          },
        },
        dispatcher,
      );
      const line = reportLine(reportId);
      const issue = (Array.isArray(answer) ? answer : []).find((item) => {
        const body = field(item, 'body');
        return typeof body === 'string' && body.includes(line);
      });
      const number = field(issue, 'number');
      const url = field(issue, 'html_url');
      return typeof number === 'number' && typeof url === 'string' ? { number, url } : null;
    },
    async postDiscord(message) {
      const url = settings.discordWebhookUrl;
      if (!url) throw new Error('Discord is not configured');
      await call(
        'Discord',
        url,
        {
          method: 'POST',
          headers: {},
          // The text comes from a customer: no @everyone or role ping, whatever it says.
          body: {
            content: message.content,
            ...(message.embed ? { embeds: [message.embed] } : {}),
            allowed_mentions: { parse: [] },
          },
        },
        dispatcher,
      );
    },
    async createNotionPage(card) {
      const notion = settings.notion;
      if (!notion) throw new Error('Notion is not configured');
      const answer = await call(
        'Notion',
        'https://api.notion.com/v1/pages',
        {
          method: 'POST',
          headers: notionHeaders(notion.token),
          body: notionPageBody(notion.databaseId, card),
        },
        dispatcher,
      );
      const id = field(answer, 'id');
      const url = field(answer, 'url');
      if (typeof id !== 'string' || typeof url !== 'string') {
        throw new Error('Notion answered without a page id');
      }
      return { id, url };
    },
    async findNotionPage(reportId) {
      const notion = settings.notion;
      if (!notion) throw new Error('Notion is not configured');
      const answer = await call(
        'Notion',
        `https://api.notion.com/v1/databases/${encodeURIComponent(notion.databaseId)}/query`,
        {
          method: 'POST',
          headers: notionHeaders(notion.token),
          body: { filter: { property: 'ID NotaFlow', rich_text: { equals: reportId } } },
        },
        dispatcher,
      );
      const results = field(answer, 'results');
      const page = Array.isArray(results) ? results[0] : undefined;
      const id = field(page, 'id');
      const url = field(page, 'url');
      return typeof id === 'string' && typeof url === 'string' ? { id, url } : null;
    },
    async setNotionStatus(pageId, status) {
      const notion = settings.notion;
      if (!notion) throw new Error('Notion is not configured');
      await call(
        'Notion',
        `https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`,
        {
          method: 'PATCH',
          headers: notionHeaders(notion.token),
          body: { properties: { Status: { select: { name: status } } } },
        },
        dispatcher,
      );
    },
  };
}
