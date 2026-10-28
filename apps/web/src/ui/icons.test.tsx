// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { IconButton } from './IconButton';
import { CopyIcon, DownloadIcon, ShareIcon } from './icons';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('an icon is decorative: hidden from assistive technology', () => {
  const { container } = render(<DownloadIcon />);
  expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
});

test('IconButton takes its accessible name and tooltip from the label', () => {
  render(
    <IconButton label="Emitir parecida" variant="primary">
      <CopyIcon />
    </IconButton>,
  );
  const button = screen.getByRole('button', { name: 'Emitir parecida' });
  expect(button.getAttribute('title')).toBe('Emitir parecida');
  expect(button.className).toContain('size-11');
  expect(button.className).toContain('sm:size-9');
  expect(button.className).toContain('bg-primary');
});

test('ShareIcon is the Apple glyph on an iPhone and the node glyph elsewhere', () => {
  vi.stubGlobal('navigator', { platform: 'iPhone', userAgent: 'iPhone' });
  const apple = render(<ShareIcon />).container.innerHTML;
  cleanup();
  vi.stubGlobal('navigator', { platform: 'Linux armv8l', userAgent: 'Android' });
  const other = render(<ShareIcon />).container.innerHTML;
  expect(apple).toContain('M6 11H5');
  expect(other).toContain('<circle');
  expect(apple).not.toBe(other);
});
