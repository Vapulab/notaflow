import './site';
import { mountLinkPage } from './linkPage';

const root = document.querySelector<HTMLElement>('[data-link-page]');
const token = window.location.pathname.split('/')[2] ?? '';
if (root) void mountLinkPage(root, encodeURIComponent(token), window.location.origin);
