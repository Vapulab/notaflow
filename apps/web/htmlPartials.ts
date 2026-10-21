import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const partialsDir = fileURLToPath(new URL('./partials/', import.meta.url));
const MARKER = /<!--partial:([a-z0-9-]+)-->/g;

// Replaces <!--partial:name--> with partials/name.html, in `vite build` and in `vite dev`.
export function htmlPartials(): Plugin {
  return {
    name: 'html-partials',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace(MARKER, (_marker, name: string) => {
          const file = `${partialsDir}${name}.html`;
          if (!existsSync(file)) throw new Error(`Missing HTML partial: partials/${name}.html`);
          return readFileSync(file, 'utf8');
        });
      },
    },
  };
}
