import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readFixture } from '../../provider-nacional/test/fixtures';
import { renderDanfse, type DanfseMark } from '../src/renderDanfse';

const FIXTURES = ['NFSE_DOMESTIC', 'NFSE_EXPORT', 'NFSE_EXPORT_FULL'];
const MARKS: DanfseMark[] = ['none', 'cancelada', 'substituida'];

const out = fileURLToPath(new URL('../golden/', import.meta.url));
mkdirSync(out, { recursive: true });
for (const fixture of FIXTURES) {
  for (const mark of MARKS) {
    const file = `${out}${fixture}-${mark}.pdf`;
    writeFileSync(file, await renderDanfse(readFixture(`${fixture}.xml`), { mark }));
    console.log(file);
  }
}
