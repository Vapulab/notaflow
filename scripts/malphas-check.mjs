import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const FILES = [
  ['apps/web/src/malphas/tokens.css', 'theme/tokens.css'],
  ['apps/web/src/malphas/preset.cjs', 'theme/preset.js'],
  ['apps/web/public/malphas-assets/fonts/SpaceGrotesk.woff2', 'assets/fonts/SpaceGrotesk.woff2'],
];

export function compareCopies(pairs) {
  return pairs.filter((pair) => !pair.local.equals(pair.remote)).map((pair) => pair.name);
}

function remote(path) {
  // A stale GH_TOKEN in the shell would override the gh login.
  const env = { ...process.env };
  delete env.GH_TOKEN;
  const base64 = execFileSync(
    'gh',
    ['api', `repos/Vapulab/malphas/contents/${path}`, '-q', '.content'],
    {
      env,
      encoding: 'utf8',
    },
  );
  return Buffer.from(base64.replace(/\s/g, ''), 'base64');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const differing = compareCopies(
    FILES.map(([local, path]) => ({
      name: local,
      local: readFileSync(local),
      remote: remote(path),
    })),
  );
  if (differing.length === 0) console.log('Malphas copies match Vapulab/malphas.');
  else {
    console.log(`Malphas copies differ: ${differing.join(', ')}. Copy them again (see SOURCE.md).`);
    process.exitCode = 1;
  }
}
