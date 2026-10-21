import { expect, test } from 'vitest';
import { chunks, notionPageBody } from './channels';

test('a long description goes to Notion in chunks of at most 2000 characters', () => {
  expect(chunks('')).toEqual(['']);
  expect(chunks('a'.repeat(4000)).map((part) => part.length)).toEqual([2000, 2000]);
  expect(chunks('a'.repeat(4001)).map((part) => part.length)).toEqual([2000, 2000, 1]);
  const body = notionPageBody('db1', {
    title: 'Erro',
    description: 'b'.repeat(3000),
    accountName: 'Conta',
    reporterEmail: null,
    screenUrl: 'https://app.example.com/app',
    issueUrl: null,
    reportedAt: new Date('2026-10-21T12:00:00Z'),
    reportId: 'r1',
  });
  const [, description] = body.children;
  expect(JSON.stringify(description)).toContain('b'.repeat(2000));
  expect(body.properties['Reportado em']).toEqual({ date: { start: '2026-10-21T12:00:00.000Z' } });
  expect(body.children.map((block) => block.type)).toEqual([
    'heading_2',
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
