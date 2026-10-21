import { expect, test } from 'vitest';
import { issueBody } from './BugReports';
import { chunks, notionPageBody } from './channels';

const CARD = {
  title: 'Erro',
  description: 'b'.repeat(3000),
  accountName: 'Conta',
  reporterEmail: null,
  screenUrl: 'https://app.example.com/app',
  issueUrl: null,
  reportedAt: new Date('2026-10-21T12:00:00Z'),
  reportId: 'r1',
  adminUrl: 'https://app.example.com/admin/bugs/r1',
  imageCount: 0,
};

test('a long description goes to Notion in chunks of at most 2000 characters', () => {
  expect(chunks('')).toEqual(['']);
  expect(chunks('a'.repeat(4000)).map((part) => part.length)).toEqual([2000, 2000]);
  expect(chunks('a'.repeat(4001)).map((part) => part.length)).toEqual([2000, 2000, 1]);
  const body = notionPageBody('db1', CARD);
  const [, description] = body.children;
  expect(JSON.stringify(description)).toContain('b'.repeat(2000));
  expect(body.properties['Reportado em']).toEqual({ date: { start: '2026-10-21T12:00:00.000Z' } });
  expect(body.children.map((block) => block.type)).toEqual([
    'heading_2',
    'paragraph',
    'paragraph',
    'heading_2',
    'paragraph',
    'heading_2',
    'paragraph',
    'heading_2',
    'to_do',
    'to_do',
    'to_do',
  ]);
});

test('the Notion card links the admin page and counts the images, with no new property', () => {
  const plain = notionPageBody('db1', CARD);
  expect(plain.children[2]).toEqual({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        {
          text: {
            content: 'Abrir no painel do NotaFlow',
            link: { url: 'https://app.example.com/admin/bugs/r1' },
          },
        },
      ],
    },
  });
  const withImages = notionPageBody('db1', { ...CARD, imageCount: 2 });
  expect(JSON.stringify(withImages.children[2])).toContain('"content":"2 imagens. "');
  expect(JSON.stringify(notionPageBody('db1', { ...CARD, imageCount: 1 }).children[2])).toContain(
    '1 imagem. ',
  );
  expect(Object.keys(withImages.properties)).toEqual(Object.keys(plain.properties));
});

test('the public issue counts the screenshots, with no link to them', () => {
  const report = { id: 'r1', description: 'Erro', pagePath: '/app/x/notas' };
  expect(issueBody({ ...report, imageCount: 0 })).not.toContain('screenshot');
  const body = issueBody({ ...report, imageCount: 3 });
  expect(body).toContain('3 screenshots, visible to the NotaFlow team.');
  expect(body).not.toContain('admin');
  expect(body).not.toContain('http');
  expect(issueBody({ ...report, imageCount: 1 })).toContain(
    '1 screenshot, visible to the NotaFlow team.',
  );
});
