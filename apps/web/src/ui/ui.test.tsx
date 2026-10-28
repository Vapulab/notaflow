// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { installDialogPolyfill } from '../test/dialog';
import {
  Badge,
  Button,
  buttonClasses,
  ButtonLink,
  Combobox,
  DateInput,
  Field,
  FileInput,
  Input,
  Modal,
  Select,
} from './index';

beforeAll(() => installDialogPolyfill());
afterEach(() => cleanup());

test('button classes are the Malphas ones', () => {
  expect(buttonClasses({ variant: 'danger', size: 'sm' })).toBe(
    'inline-flex items-center justify-center font-medium rounded transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 bg-danger text-danger-fg hover:bg-danger/90 h-8 px-3 text-sm',
  );
});

test('a Button is type button unless told otherwise', () => {
  render(<Button>Salvar</Button>);
  expect(screen.getByRole('button', { name: 'Salvar' }).getAttribute('type')).toBe('button');
});

test('a Field names a select by its label alone, and describes it with the hint', () => {
  render(
    <Field label="Faixa" hint="A faixa do mês anterior.">
      <Select>
        <option>Faixa 1</option>
      </Select>
    </Field>,
  );
  const select = screen.getByLabelText('Faixa');
  expect(select.tagName).toBe('SELECT');
  expect(select.getAttribute('aria-describedby')).toBeTruthy();
  expect(screen.getByRole('combobox', { name: 'Faixa' })).toBe(select);
});

test('a Field label names its control', () => {
  render(
    <Field label="E-mail">
      <Input type="email" />
    </Field>,
  );
  expect(screen.getByLabelText('E-mail').tagName).toBe('INPUT');
});

test('the Modal opens, shows its title, and closes from its button', () => {
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <Modal open={open} title="Cancelar nota" onClose={() => setOpen(false)}>
        <Badge variant="danger">PRODUÇÃO</Badge>
      </Modal>
    );
  }
  render(<Host />);
  expect(screen.getByRole('dialog', { name: 'Cancelar nota' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

function ComboHost(props: { selected: boolean }) {
  return (
    <Combobox
      label="Município"
      query=""
      onQueryChange={() => {}}
      options={[]}
      selected={props.selected ? { value: '1', label: 'Londrina - PR' } : null}
      onSelect={() => {}}
    />
  );
}

test('a combobox with a choice and no search opens no empty list', () => {
  render(<ComboHost selected />);
  fireEvent.focus(screen.getByRole('combobox'));
  expect(screen.queryByRole('listbox')).toBeNull();
});

test('Escape closes the open list and stops there, so a dialog around it stays open', () => {
  render(<ComboHost selected={false} />);
  const input = screen.getByRole('combobox');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'lon' } });
  expect(screen.getByRole('listbox')).toBeTruthy();
  const notPrevented = fireEvent.keyDown(input, { key: 'Escape' });
  expect(notPrevented).toBe(false);
  expect(screen.queryByRole('listbox')).toBeNull();
});

test('a FileInput is a native file input whose button has the Malphas secondary look', () => {
  render(
    <Field label="Arquivo">
      <FileInput accept="application/pdf" />
    </Field>,
  );
  const input = screen.getByLabelText('Arquivo');
  expect(input.getAttribute('type')).toBe('file');
  expect(input.getAttribute('accept')).toBe('application/pdf');
  for (const token of ['file:border-border', 'file:bg-surface', 'file:text-fg', 'file:rounded']) {
    expect(input.className, token).toContain(token);
  }
});

test('a ButtonLink looks like the button only, without the link color that hides its text on hover', () => {
  render(<ButtonLink href="/app">Nova nota</ButtonLink>);
  const link = screen.getByRole('link', { name: 'Nova nota' });
  expect(link.className).toBe(buttonClasses({ variant: 'primary' }));
  expect(link.className).not.toContain('hover:text-primary');
});

test('an empty DateInput shows the dd/mm/aaaa hint on touch screens; a filled one does not', () => {
  function Harness() {
    const [value, setValue] = useState('');
    return (
      <Field label="Competência de">
        <DateInput value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
    );
  }
  render(<Harness />);
  const input = screen.getByLabelText('Competência de');
  expect(input.getAttribute('type')).toBe('date');
  const hint = screen.getByText('dd/mm/aaaa');
  expect(hint.getAttribute('aria-hidden')).toBe('true');
  expect(hint.className).toContain('[@media(pointer:coarse)]:block');
  expect(input.className).toContain('[@media(pointer:coarse)]:text-transparent');
  fireEvent.change(input, { target: { value: '2026-10-01' } });
  expect(screen.queryByText('dd/mm/aaaa')).toBeNull();
  expect(input.className).not.toContain('text-transparent');
});
