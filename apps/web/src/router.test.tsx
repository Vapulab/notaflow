// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { legacyHashTarget, navigate, parseRoute, type Route, routeHref, useRoute } from './router';

const at = (path: string) => {
  const url = new URL(path, 'http://localhost');
  return parseRoute({ pathname: url.pathname, search: url.search });
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

const ROUTES: [string, Route][] = [
  ['/entrar', { name: 'login' }],
  ['/cadastro', { name: 'signup' }],
  ['/recuperar-senha', { name: 'reset' }],
  ['/app', { name: 'home' }],
  ['/app/conta', { name: 'profile' }],
  ['/app/comecar', { name: 'onboarding' }],
  ['/app/comecar/acc', { name: 'onboarding', accountId: 'acc' }],
  ['/admin', { name: 'admin' }],
  ['/app/acc/notas', { name: 'invoices', accountId: 'acc' }],
  ['/app/acc/notas/inv1', { name: 'invoice', accountId: 'acc', invoiceId: 'inv1' }],
  ['/app/acc/notas/nova', { name: 'newInvoice', accountId: 'acc' }],
  ['/app/acc/notas/nova?cliente=c1', { name: 'newInvoice', accountId: 'acc', customerId: 'c1' }],
  ['/app/acc/notas/inv1/emitir', { name: 'issue', accountId: 'acc', invoiceId: 'inv1' }],
  ['/app/acc/clientes', { name: 'customers', accountId: 'acc' }],
  ['/app/acc/clientes/c1', { name: 'customer', accountId: 'acc', customerId: 'c1' }],
  ['/app/acc/emitentes', { name: 'emitters', accountId: 'acc' }],
  ['/app/acc/emitentes/em1', { name: 'emitter', accountId: 'acc', emitterId: 'em1' }],
  ['/app/acc/membros', { name: 'members', accountId: 'acc' }],
];

test.each(ROUTES)('%s parses, and the route writes it back', (path, route) => {
  expect(at(path)).toEqual(route);
  expect(routeHref(route)).toBe(path);
});

test('ids that need encoding survive the round trip', () => {
  const route = { name: 'invoice', accountId: 'a b', invoiceId: 'i/1' } as const;
  expect(at(routeHref(route))).toEqual(route);
});

test.each(['/', '/nada', '/app/acc', '/app/acc/desconhecido', '/app/comecar/acc/extra'])(
  '%s is the home',
  (path) => {
    expect(at(path)).toEqual({ name: 'home' });
  },
);

test('reserved names under /app are never an account', () => {
  expect(at('/app/conta')).toEqual({ name: 'profile' });
  expect(at('/app/conta/notas')).toEqual({ name: 'home' });
});

test.each([
  ['#/', '/app'],
  ['#/admin', '/admin'],
  ['#/a/x/emitters', '/app/x/emitentes'],
  ['#/a/x/emitters/e', '/app/x/emitentes/e'],
  ['#/a/x/invoices', '/app/x/notas'],
  ['#/a/x/invoices/new', '/app/x/notas/nova'],
  ['#/a/x/invoices/new?customer=c', '/app/x/notas/nova?cliente=c'],
  ['#/a/x/invoices/i', '/app/x/notas/i'],
  ['#/a/x/invoices/i/issue', '/app/x/notas/i/emitir'],
  ['#/a/x/members', '/app/x/membros'],
  ['#/a/x/customers', '/app/x/clientes'],
  ['#/a/x/customers/c', '/app/x/clientes/c'],
  ['#/coisa/estranha', '/app'],
])('the old link %s goes to %s', (hash, path) => {
  expect(legacyHashTarget(hash)).toBe(path);
});

test('no hash, no redirect', () => {
  expect(legacyHashTarget('')).toBeNull();
  expect(legacyHashTarget('#')).toBeNull();
});

function Where() {
  const route = useRoute();
  return (
    <div>
      <p>{route.name}</p>
      <a href="/app/acc/notas">notas</a>
      <a href="/app/acc/clientes" target="_blank">
        nova aba
      </a>
    </div>
  );
}

test('navigate pushes a path and the current route follows', () => {
  window.history.replaceState(null, '', '/app');
  render(<Where />);
  expect(screen.getByText('home')).toBeTruthy();
  act(() => navigate({ name: 'members', accountId: 'acc' }));
  expect(window.location.pathname).toBe('/app/acc/membros');
  expect(screen.getByText('members')).toBeTruthy();
  act(() => window.history.back());
});

test('a plain click on an internal link stays in the app; Ctrl or a new tab does not', () => {
  window.history.replaceState(null, '', '/app');
  render(<Where />);
  // Runs after the app's document listener: records its choice, then stops jsdom's own navigation.
  const prevented: boolean[] = [];
  const record = (event: Event) => {
    prevented.push(event.defaultPrevented);
    event.preventDefault();
  };
  window.addEventListener('click', record);
  const click = (text: string, init: MouseEventInit = {}) =>
    act(() => {
      screen
        .getByText(text)
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
    });
  click('notas', { ctrlKey: true });
  expect(window.location.pathname).toBe('/app');
  click('nova aba');
  click('notas');
  window.removeEventListener('click', record);
  expect(prevented).toEqual([false, false, true]);
  expect(window.location.pathname).toBe('/app/acc/notas');
  expect(screen.getByText('invoices')).toBeTruthy();
});

test('an old hash link is replaced by its path on the first render', () => {
  window.history.replaceState(null, '', '/#/a/acc/invoices/inv1');
  render(<Where />);
  expect(window.location.pathname).toBe('/app/acc/notas/inv1');
  expect(window.location.hash).toBe('');
  expect(screen.getByText('invoice')).toBeTruthy();
});

test('a path or old link that does not decode goes home instead of breaking the app', () => {
  expect(at('/app/%E0/notas')).toEqual({ name: 'home' });
  expect(legacyHashTarget('#/a/%zz/invoices')).toBe('/app');
});
