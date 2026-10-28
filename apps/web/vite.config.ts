import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { GUIDE_PAGES } from './src/site/guide/pages';
import { htmlPartials } from './htmlPartials';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react(), htmlPartials()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3000' } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The public pages are plain HTML, apart from the app: fast, indexable, and served by the server.
    rollupOptions: {
      input: {
        app: resolve(root, 'index.html'),
        landing: resolve(root, 'landing.html'),
        termos: resolve(root, 'termos.html'),
        privacidade: resolve(root, 'privacidade.html'),
        link: resolve(root, 'n.html'),
        notFound: resolve(root, '404.html'),
        ...Object.fromEntries(
          GUIDE_PAGES.map((page) => [page.file.replace('.html', ''), resolve(root, page.file)]),
        ),
      },
    },
  },
});
