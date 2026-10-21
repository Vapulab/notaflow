import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { DpsLayout } from '../src/dps/layout';

const SCRIPT = fileURLToPath(new URL('../../../tools/xsd/validate.py', import.meta.url));
const SCHEMAS: Record<DpsLayout, string> = {
  nt004: fileURLToPath(new URL('../schemas/', import.meta.url)),
  nt009: fileURLToPath(new URL('../schemas/nt009/', import.meta.url)),
};

export function validateAgainstXsd(
  xml: string,
  schemaFile: string,
  layout: DpsLayout,
): { valid: boolean; errors: string[] } {
  const python = process.env.PYTHON ?? 'python';
  const result = spawnSync(python, ['-P', SCRIPT, `${SCHEMAS[layout]}${schemaFile}`], {
    input: xml,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  const errors = `${result.stdout}${result.stderr}`.split('\n').filter(Boolean);
  return { valid: result.status === 0, errors };
}
