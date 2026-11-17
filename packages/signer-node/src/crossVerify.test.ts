import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { SignatureProfile } from '@notaflow/core';
import { makeTestCertificate } from '@notaflow/test-kit';
import { describe, expect, test } from 'vitest';
import { loadCertificate } from './loadCertificate';
import { NodeSigner } from './NodeSigner';
import { verifyXmlSignature } from './verifyXmlSignature';

const SERVICE_DIR = fileURLToPath(new URL('../../../services/signer-py', import.meta.url));
const ID = 'DPS355030821234567800019500900000000000000001';
const XML = `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="${ID}"><xDescServ>análise</xDescServ></infDPS></DPS>`;

function python(command: 'sign' | 'verify', payload: object): Record<string, unknown> {
  const result = spawnSync(process.env.PYTHON ?? 'python', ['-m', 'notaflow_signer.cli', command], {
    cwd: SERVICE_DIR,
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

const testCert = makeTestCertificate();
const certificate = loadCertificate(testCert.pfx, testCert.password);

async function pythonVerifiesNodeSignature(profile: SignatureProfile): Promise<void> {
  const signed = await new NodeSigner().sign({
    xml: XML,
    elementName: 'infDPS',
    certificate,
    profile,
  });
  expect(python('verify', { xml: signed, certificate_pem: certificate.certificatePem })).toEqual({
    valid: true,
  });
}

// signxml before 5.3.0 rejected the inclusive-C14N one: a false xmlns="" under the Signature.
test.each<SignatureProfile>(['rsa-sha256-exc-c14n', 'rsa-sha1-c14n'])(
  'Python verifies a Node signature (%s)',
  (profile) => pythonVerifiesNodeSignature(profile),
);

describe.each<SignatureProfile>(['rsa-sha1-c14n', 'rsa-sha256-exc-c14n'])(
  'Node verifies a Python signature, %s',
  (profile) => {
    test('Node verifies a Python signature', () => {
      const { xml } = python('sign', {
        xml: XML,
        pfx_b64: testCert.pfx.toString('base64'),
        password: testCert.password,
        element_id: ID,
        profile,
      });
      expect(verifyXmlSignature(String(xml), certificate.certificatePem)).toBe(true);
    });
  },
);
