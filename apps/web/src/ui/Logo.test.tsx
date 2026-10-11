// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { Logo, LogoMark } from './Logo';

afterEach(cleanup);

test('the logo is the NF mark with the name, read as one link text', () => {
  render(<Logo />);
  expect(screen.getByText('NotaFlow')).toBeTruthy();
  expect(document.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
});

test('two marks on one page keep their own gap mask', () => {
  render(
    <>
      <LogoMark />
      <LogoMark />
    </>,
  );
  const masks = [...document.querySelectorAll('mask')].map((m) => m.id);
  expect(new Set(masks).size).toBe(2);
  for (const svg of document.querySelectorAll('svg')) {
    const used = svg.querySelector('[mask]')?.getAttribute('mask');
    expect(used).toBe(`url(#${svg.querySelector('mask')?.id})`);
  }
});
