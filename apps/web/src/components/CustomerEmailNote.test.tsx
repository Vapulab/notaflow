// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { CustomerEmailNote } from './CustomerEmailNote';

afterEach(cleanup);

const note = (autoEmailCustomer: boolean, environment: 'producao' | 'producao_restrita') =>
  render(<CustomerEmailNote accountId="a" emitter={{ id: 'e', autoEmailCustomer, environment }} />);

test('the note shows only when the e-mail is on and the emitter is in produção', () => {
  note(true, 'producao');
  expect(screen.getByText(/vai receber por e-mail/)).toBeTruthy();
});

test.each([
  [true, 'producao_restrita'],
  [false, 'producao'],
] as const)('no note for auto %s in %s', (auto, environment) => {
  note(auto, environment);
  expect(screen.queryByText(/vai receber por e-mail/)).toBeNull();
});
