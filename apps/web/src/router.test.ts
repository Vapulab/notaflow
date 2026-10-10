import { expect, test } from 'vitest';
import { parseRoute, routeHref } from './router';

test.each([
  ['', { name: 'home' }],
  ['#/', { name: 'home' }],
  ['#/a/acc1/emitters', { name: 'emitters', accountId: 'acc1' }],
  ['#/a/acc1/invoices', { name: 'invoices', accountId: 'acc1' }],
  ['#/a/acc1/invoices/inv9', { name: 'invoice', accountId: 'acc1', invoiceId: 'inv9' }],
  ['#/a/acc1/members', { name: 'members', accountId: 'acc1' }],
  ['#/admin', { name: 'admin' }],
  ['#/unknown/path', { name: 'home' }],
])('parseRoute(%s)', (hash, route) => {
  expect(parseRoute(hash)).toEqual(route);
});

test('routeHref is the inverse of parseRoute', () => {
  const route = { name: 'invoice', accountId: 'a b', invoiceId: 'i/1' } as const;
  expect(parseRoute(routeHref(route))).toEqual(route);
});

test('customer routes', () => {
  expect(parseRoute('#/a/acc/customers')).toEqual({ name: 'customers', accountId: 'acc' });
  expect(parseRoute('#/a/acc/customers/c1')).toEqual({
    name: 'customer',
    accountId: 'acc',
    customerId: 'c1',
  });
  expect(routeHref({ name: 'customer', accountId: 'acc', customerId: 'c1' })).toBe(
    '#/a/acc/customers/c1',
  );
});

test('the issue route', () => {
  expect(parseRoute('#/a/acc/invoices/inv1/issue')).toEqual({
    name: 'issue',
    accountId: 'acc',
    invoiceId: 'inv1',
  });
  expect(routeHref({ name: 'issue', accountId: 'acc', invoiceId: 'inv1' })).toBe(
    '#/a/acc/invoices/inv1/issue',
  );
});

test('the emitter page route', () => {
  const route = { name: 'emitter', accountId: 'acc', emitterId: 'em1' } as const;
  expect(parseRoute('#/a/acc/emitters/em1')).toEqual(route);
  expect(routeHref(route)).toBe('#/a/acc/emitters/em1');
});

test('the new invoice route, before an invoice id, with an optional customer', () => {
  expect(parseRoute('#/a/acc/invoices/new')).toEqual({ name: 'newInvoice', accountId: 'acc' });
  expect(parseRoute('#/a/acc/invoices/new?customer=c1')).toEqual({
    name: 'newInvoice',
    accountId: 'acc',
    customerId: 'c1',
  });
  expect(routeHref({ name: 'newInvoice', accountId: 'acc' })).toBe('#/a/acc/invoices/new');
  expect(routeHref({ name: 'newInvoice', accountId: 'acc', customerId: 'c1' })).toBe(
    '#/a/acc/invoices/new?customer=c1',
  );
  expect(parseRoute('#/a/acc/invoices/inv1')).toEqual({
    name: 'invoice',
    accountId: 'acc',
    invoiceId: 'inv1',
  });
});
