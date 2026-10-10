// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { installDialogPolyfill } from '../test/dialog';
import { Badge, Button, buttonClasses, Combobox, Field, Input, Modal, Select } from './index';

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
