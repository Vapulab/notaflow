import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'emitters'; accountId: string }
  | { name: 'emitter'; accountId: string; emitterId: string }
  | { name: 'invoices'; accountId: string }
  | { name: 'invoice'; accountId: string; invoiceId: string }
  | { name: 'newInvoice'; accountId: string; customerId?: string }
  | { name: 'issue'; accountId: string; invoiceId: string }
  | { name: 'members'; accountId: string }
  | { name: 'customers'; accountId: string }
  | { name: 'customer'; accountId: string; customerId: string }
  | { name: 'admin' };

export function parseRoute(hash: string): Route {
  const [path = '', search = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  // The fourth part is an invoice, customer, or emitter id, by section.
  const [first, accountId, section, invoiceId] = parts;
  if (first === 'admin' && parts.length === 1) return { name: 'admin' };
  if (first === 'a' && accountId) {
    if (section === 'emitters' && parts.length === 3) return { name: 'emitters', accountId };
    if (section === 'emitters' && invoiceId && parts.length === 4) {
      return { name: 'emitter', accountId, emitterId: invoiceId };
    }
    if (section === 'invoices' && parts.length === 3) return { name: 'invoices', accountId };
    if (section === 'invoices' && invoiceId === 'new' && parts.length === 4) {
      const customerId = new URLSearchParams(search).get('customer');
      return { name: 'newInvoice', accountId, ...(customerId ? { customerId } : {}) };
    }
    if (section === 'invoices' && invoiceId && parts.length === 4) {
      return { name: 'invoice', accountId, invoiceId };
    }
    if (section === 'invoices' && invoiceId && parts[4] === 'issue' && parts.length === 5) {
      return { name: 'issue', accountId, invoiceId };
    }
    if (section === 'members' && parts.length === 3) return { name: 'members', accountId };
    if (section === 'customers' && parts.length === 3) return { name: 'customers', accountId };
    if (section === 'customers' && invoiceId && parts.length === 4) {
      return { name: 'customer', accountId, customerId: invoiceId };
    }
  }
  return { name: 'home' };
}

export function routeHref(route: Route): string {
  const e = encodeURIComponent;
  switch (route.name) {
    case 'home':
      return '#/';
    case 'admin':
      return '#/admin';
    case 'invoice':
      return `#/a/${e(route.accountId)}/invoices/${e(route.invoiceId)}`;
    case 'issue':
      return `#/a/${e(route.accountId)}/invoices/${e(route.invoiceId)}/issue`;
    case 'newInvoice':
      return `#/a/${e(route.accountId)}/invoices/new${route.customerId ? `?customer=${e(route.customerId)}` : ''}`;
    case 'emitter':
      return `#/a/${e(route.accountId)}/emitters/${e(route.emitterId)}`;
    case 'customer':
      return `#/a/${e(route.accountId)}/customers/${e(route.customerId)}`;
    default:
      return `#/a/${e(route.accountId)}/${route.name}`;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
