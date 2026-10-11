import { useEffect, useState } from 'react';

export type Route =
  | { name: 'login' }
  | { name: 'signup' }
  | { name: 'reset' }
  | { name: 'home' }
  | { name: 'profile' }
  | { name: 'admin' }
  | { name: 'emitters'; accountId: string }
  | { name: 'emitter'; accountId: string; emitterId: string }
  | { name: 'invoices'; accountId: string }
  | { name: 'invoice'; accountId: string; invoiceId: string }
  | { name: 'newInvoice'; accountId: string; customerId?: string }
  | { name: 'issue'; accountId: string; invoiceId: string }
  | { name: 'members'; accountId: string }
  | { name: 'customers'; accountId: string }
  | { name: 'customer'; accountId: string; customerId: string };

const PUBLIC: Record<string, Route> = {
  entrar: { name: 'login' },
  cadastro: { name: 'signup' },
  'recuperar-senha': { name: 'reset' },
  admin: { name: 'admin' },
};
// Names under /app that are pages, never an account id.
const RESERVED = new Set(['conta', 'comecar']);

export function parseRoute(location: { pathname: string; search: string }): Route {
  const parts = location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const [first, accountId, section, id, action] = parts;
  if (first && parts.length === 1 && PUBLIC[first]) return PUBLIC[first];
  if (first !== 'app' || !accountId) return { name: 'home' };
  if (accountId === 'conta' && parts.length === 2) return { name: 'profile' };
  if (RESERVED.has(accountId)) return { name: 'home' };
  const length = parts.length;
  switch (section) {
    case 'notas':
      if (length === 3) return { name: 'invoices', accountId };
      if (id === 'nova' && length === 4) {
        const customerId = new URLSearchParams(location.search).get('cliente');
        return { name: 'newInvoice', accountId, ...(customerId ? { customerId } : {}) };
      }
      if (id && length === 4) return { name: 'invoice', accountId, invoiceId: id };
      if (id && action === 'emitir' && length === 5)
        return { name: 'issue', accountId, invoiceId: id };
      break;
    case 'clientes':
      if (length === 3) return { name: 'customers', accountId };
      if (id && length === 4) return { name: 'customer', accountId, customerId: id };
      break;
    case 'emitentes':
      if (length === 3) return { name: 'emitters', accountId };
      if (id && length === 4) return { name: 'emitter', accountId, emitterId: id };
      break;
    case 'membros':
      if (length === 3) return { name: 'members', accountId };
      break;
  }
  return { name: 'home' };
}

export function routeHref(route: Route): string {
  const e = encodeURIComponent;
  switch (route.name) {
    case 'login':
      return '/entrar';
    case 'signup':
      return '/cadastro';
    case 'reset':
      return '/recuperar-senha';
    case 'home':
      return '/app';
    case 'profile':
      return '/app/conta';
    case 'admin':
      return '/admin';
    case 'invoices':
      return `/app/${e(route.accountId)}/notas`;
    case 'invoice':
      return `/app/${e(route.accountId)}/notas/${e(route.invoiceId)}`;
    case 'issue':
      return `/app/${e(route.accountId)}/notas/${e(route.invoiceId)}/emitir`;
    case 'newInvoice':
      return `/app/${e(route.accountId)}/notas/nova${route.customerId ? `?cliente=${e(route.customerId)}` : ''}`;
    case 'customers':
      return `/app/${e(route.accountId)}/clientes`;
    case 'customer':
      return `/app/${e(route.accountId)}/clientes/${e(route.customerId)}`;
    case 'emitters':
      return `/app/${e(route.accountId)}/emitentes`;
    case 'emitter':
      return `/app/${e(route.accountId)}/emitentes/${e(route.emitterId)}`;
    case 'members':
      return `/app/${e(route.accountId)}/membros`;
  }
}

// The hash routes of stage 2 (#/a/:account/...), so saved links and bookmarks keep working.
export function legacyHashTarget(hash: string): string | null {
  const [path = '', search = ''] = hash.replace(/^#\/?/, '').split('?');
  if (hash === '' || hash === '#') return null;
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const [first, accountId, section, id, action] = parts;
  if (parts.length === 0) return routeHref({ name: 'home' });
  if (first === 'admin' && parts.length === 1) return routeHref({ name: 'admin' });
  if (first !== 'a' || !accountId) return routeHref({ name: 'home' });
  const length = parts.length;
  let route: Route = { name: 'home' };
  if (section === 'emitters' && length === 3) route = { name: 'emitters', accountId };
  else if (section === 'emitters' && id && length === 4)
    route = { name: 'emitter', accountId, emitterId: id };
  else if (section === 'invoices' && length === 3) route = { name: 'invoices', accountId };
  else if (section === 'invoices' && id === 'new' && length === 4) {
    const customerId = new URLSearchParams(search).get('customer');
    route = { name: 'newInvoice', accountId, ...(customerId ? { customerId } : {}) };
  } else if (section === 'invoices' && id && length === 4)
    route = { name: 'invoice', accountId, invoiceId: id };
  else if (section === 'invoices' && id && action === 'issue' && length === 5)
    route = { name: 'issue', accountId, invoiceId: id };
  else if (section === 'members' && length === 3) route = { name: 'members', accountId };
  else if (section === 'customers' && length === 3) route = { name: 'customers', accountId };
  else if (section === 'customers' && id && length === 4)
    route = { name: 'customer', accountId, customerId: id };
  return routeHref(route);
}

const NAVIGATE = 'notaflow:navigate';

export function navigate(to: Route | string, options: { replace?: boolean } = {}): void {
  const href = typeof to === 'string' ? to : routeHref(to);
  if (options.replace) window.history.replaceState(null, '', href);
  else window.history.pushState(null, '', href);
  window.dispatchEvent(new Event(NAVIGATE));
}

function current(): Route {
  return parseRoute(window.location);
}

// A plain left click on a same-origin link stays in the app; modifiers and new tabs keep the browser's way.
function onLinkClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const anchor = (event.target as Element | null)?.closest?.('a');
  if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) {
    return;
  }
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin || url.pathname.startsWith('/api/')) return;
  event.preventDefault();
  navigate(url.pathname + url.search);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => {
    const legacy = legacyHashTarget(window.location.hash);
    if (legacy) window.history.replaceState(null, '', legacy);
    return current();
  });
  useEffect(() => {
    const onChange = () => setRoute(current());
    window.addEventListener('popstate', onChange);
    window.addEventListener(NAVIGATE, onChange);
    document.addEventListener('click', onLinkClick);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener(NAVIGATE, onChange);
      document.removeEventListener('click', onLinkClick);
    };
  }, []);
  return route;
}
