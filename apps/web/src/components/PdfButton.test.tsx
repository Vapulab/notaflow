// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { PdfButton } from './PdfButton';

afterEach(cleanup);

test('pending shows a spinner and "Gerando PDF…", and the button still downloads', async () => {
  const onDownload = vi.fn();
  render(<PdfButton status="pending" label="PDF" onDownload={onDownload} />);
  const button = screen.getByRole('button', { name: /gerando pdf…/i });
  expect(button.querySelector('[aria-live="polite"]')).toBeTruthy();
  expect(button.querySelector('.animate-spin')).toBeTruthy();
  expect(screen.queryByText('PDF')).toBeNull();
  await userEvent.setup().click(button);
  expect(onDownload).toHaveBeenCalledTimes(1);
});

test.each(['ready', 'failed', null] as const)('%s shows the label', (status) => {
  render(<PdfButton status={status} label="Baixar PDF" onDownload={() => {}} />);
  expect(screen.getByRole('button', { name: 'Baixar PDF' })).toBeTruthy();
  expect(screen.queryByText(/gerando/i)).toBeNull();
});

test('the icon variant is a named button with a spinner while pending, still clickable', async () => {
  const onDownload = vi.fn();
  const { rerender } = render(
    <PdfButton variant="icon" status="ready" label="Baixar PDF" onDownload={onDownload} />,
  );
  expect(screen.getByRole('button', { name: 'Baixar PDF' }).textContent).toBe('');
  rerender(
    <PdfButton variant="icon" status="pending" label="Baixar PDF" onDownload={onDownload} />,
  );
  const button = screen.getByRole('button', { name: 'Gerando PDF' });
  expect(button.querySelector('.animate-spin')).toBeTruthy();
  await userEvent.setup().click(button);
  expect(onDownload).toHaveBeenCalledTimes(1);
});
