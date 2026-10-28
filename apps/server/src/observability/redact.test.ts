import { describe, expect, test } from 'vitest';
import { argForLog, redactLogArgs, requestForLog } from './logger';
import { MAX_TEXT, REDACTED, redactError, redactText, redactUrl, redactValue } from './redact';

const TOKEN = 'Zx9_-'.repeat(8) + 'abc';

describe('redactUrl', () => {
  test('a link token in the page, API, and PDF path becomes a placeholder', () => {
    expect(redactUrl(`/n/${TOKEN}`)).toBe('/n/:token');
    expect(redactUrl(`/api/public/n/${TOKEN}`)).toBe('/api/public/n/:token');
    expect(redactUrl(`/api/public/n/${TOKEN}/pdf`)).toBe('/api/public/n/:token/pdf');
  });

  test('the CNPJ of the public regime lookup becomes a placeholder', () => {
    expect(redactUrl('/api/public/cnpj-regime/12345678000195')).toBe(
      '/api/public/cnpj-regime/:cnpj',
    );
  });

  test('a Discord webhook token becomes a placeholder', () => {
    expect(redactUrl(`https://discord.com/api/webhooks/123/${TOKEN}`)).toBe(
      'https://discord.com/api/webhooks/123/:token',
    );
  });

  test('every query parameter is dropped except the allowed ones', () => {
    expect(redactUrl('/api/auth/callback/google?code=SEGREDO&state=abc')).toBe(
      '/api/auth/callback/google',
    );
    expect(redactUrl('/nota/descadastrar?a=ana%40example.com&t=sig')).toBe('/nota/descadastrar');
    expect(redactUrl('/lembretes/descadastrar?u=user-1&t=sig')).toBe('/lembretes/descadastrar');
    expect(redactUrl('/api/admin/users?q=ana@example.com')).toBe('/api/admin/users');
    expect(redactUrl('/api/accounts/a1/invoices?q=Fulano&limit=20&offset=40&status=issued')).toBe(
      '/api/accounts/a1/invoices?limit=20&offset=40&status=issued',
    );
    expect(redactUrl('/x?key=abc#frag')).toBe('/x');
  });

  test('a caller can drop every parameter', () => {
    expect(redactUrl('/api/admin/audit?limit=1', new Set())).toBe('/api/admin/audit');
  });

  test('an e-mail or a document in a path is masked', () => {
    expect(redactUrl('/x/ana@example.com/111.444.777-35')).toBe('/x/***@example.com/***');
  });
});

describe('redactText', () => {
  test('an e-mail keeps only its domain, and punctuation after it stays', () => {
    expect(redactText('para ana@example.com, e to=bia@ex.com.br.')).toBe(
      'para ***@example.com, e to=***@ex.com.br.',
    );
  });

  test('a CPF is masked with or without punctuation', () => {
    expect(redactText('CPF 111.444.777-35 e 11144477735')).toBe('CPF *** e ***');
  });

  test('a CNPJ is masked with or without punctuation, numeric or alphanumeric', () => {
    expect(redactText('CNPJ 12.345.678/0001-95, 12345678000195 e 12ABC34501DE35')).toBe(
      'CNPJ ***, *** e ***',
    );
  });

  test('a 50-character access key and a UUID stay', () => {
    const accessKey = '3'.repeat(50);
    const id = '123e4567-e89b-12d3-a456-426614174000';
    expect(redactText(`${accessKey} ${id}`)).toBe(`${accessKey} ${id}`);
  });

  test('a link token in a message becomes a placeholder', () => {
    expect(redactText(`Route GET:/n/${TOKEN} not found`)).toBe('Route GET:/n/:token not found');
  });

  test('the query of a URL or a path in a message is dropped', () => {
    expect(redactText('Route GET:/foo?token=abc&x=1 not found')).toBe('Route GET:/foo not found');
    expect(
      redactText('PUT https://bucket.r2.dev/k.png?X-Amz-Signature=abc&X-Amz-Credential=x failed'),
    ).toBe('PUT https://bucket.r2.dev/k.png failed');
  });

  test('a secret pair and a bearer credential are masked', () => {
    expect(redactText('token=abc password=hunter2 apiKey=re_123')).toBe(
      'token=*** password=*** apiKey=***',
    );
    expect(redactText('Authorization: Bearer ghp_abc.def')).toBe('Authorization: Bearer ***');
  });

  test('a domain alone stays', () => {
    expect(redactText('mail to @example.com gave up')).toBe('mail to @example.com gave up');
  });
});

describe('redactValue', () => {
  test('strings at any depth are redacted, and secret keys are replaced', () => {
    expect(
      redactValue({
        module: 'mail',
        to: 'ana@example.com',
        nested: { list: ['111.444.777-35'], password: 'x', Authorization: 'Bearer y' },
        pfx: Buffer.from('cert'),
        count: 3,
      }),
    ).toEqual({
      module: 'mail',
      to: '***@example.com',
      nested: { list: [REDACTED], password: REDACTED, Authorization: REDACTED },
      pfx: REDACTED,
      count: 3,
    });
  });

  test('an Error or a class instance is left for its serializer', () => {
    const error = new Error('x');
    const buffer = Buffer.from('y');
    const out = redactValue({ err: error, data: buffer }) as Record<string, unknown>;
    expect(out.err).toBe(error);
    expect(out.data).toBe(buffer);
  });
});

describe('redactError', () => {
  test('the message, stack, own fields, and cause are redacted', () => {
    const cause = new Error('lookup for 12345678000195 failed');
    const error = Object.assign(new Error('send to ana@example.com failed', { cause }), {
      code: 'E0014',
      token: 'abc',
    });
    const out = redactError(error) as Record<string, unknown>;
    expect(out).toMatchObject({
      type: 'Error',
      message: 'send to ***@example.com failed',
      code: 'E0014',
      token: REDACTED,
      cause: { message: 'lookup for *** failed' },
    });
    expect(String(out.stack)).not.toContain('ana@example.com');
  });
});

describe('logger', () => {
  test('the request serializer keeps the operational fields and redacts the URL', () => {
    expect(
      requestForLog({
        method: 'GET',
        url: `/api/public/n/${TOKEN}/pdf?download=1`,
        host: 'notaflow.vapulab.com',
        ip: '203.0.113.7',
        socket: { remotePort: 443 },
      }),
    ).toEqual({
      method: 'GET',
      url: '/api/public/n/:token/pdf',
      host: 'notaflow.vapulab.com',
      remoteAddress: '203.0.113.7',
      remotePort: 443,
    });
  });

  test('the hook redacts messages and objects, and moves a lone error under err', () => {
    expect(
      redactLogArgs([{ invoiceId: 'i1', to: 'ana@example.com' }, 'sent to %s', 'b@ex.com']),
    ).toEqual([{ invoiceId: 'i1', to: '***@example.com' }, 'sent to %s', '***@ex.com']);
    const error = new Error('CPF 11144477735 refused');
    expect(redactLogArgs([error])).toEqual([{ err: error }, 'CPF *** refused']);
  });
});

describe('Sentry mode', () => {
  test('an e-mail and a document leave no part', () => {
    expect(redactText('ana@example.com, CPF 111.444.777-35', { personal: 'sentry' })).toBe(
      '[e-mail], CPF [documento]',
    );
    expect(redactValue({ to: 'ana@example.com' }, { personal: 'sentry' })).toEqual({
      to: '[e-mail]',
    });
  });
});

describe('limits', () => {
  test('an object deeper than the limit is replaced, not passed through', () => {
    let deep: Record<string, unknown> = { to: 'ana@example.com' };
    for (let i = 0; i < 10; i += 1) deep = { next: deep };
    expect(JSON.stringify(redactValue(deep))).not.toContain('ana@example.com');
    expect(JSON.stringify(redactValue(deep))).toContain(REDACTED);
  });

  test('a 16 KB path is truncated and redacted in linear time', () => {
    const inputs = [
      `/${'a'.repeat(16_384)}`,
      '/a'.repeat(8192) + '?x',
      `${'a.'.repeat(8192)}@`,
      'a'.repeat(16_384),
    ];
    for (const input of inputs) {
      const started = performance.now();
      const text = redactText(`Route GET:${input} not found`);
      const url = redactUrl(input);
      expect(performance.now() - started).toBeLessThan(20);
      expect(text.length).toBeLessThan(MAX_TEXT + 40);
      expect(text).toContain('…[truncado]');
      expect(url.length).toBeLessThan(MAX_TEXT + 40);
    }
  });
});

describe('argForLog', () => {
  test('an object becomes redacted JSON, and an error keeps its message and stack', () => {
    expect(argForLog({ to: 'ana@example.com', token: 'abc' })).toBe(
      '{"to":"***@example.com","token":"***"}',
    );
    const parsed = JSON.parse(argForLog(new Error('send to ana@example.com failed'))) as {
      message: string;
      stack: string;
    };
    expect(parsed.message).toBe('send to ***@example.com failed');
    expect(parsed.stack).toContain('send to ***@example.com failed');
  });
});

describe('fix round 2', () => {
  const pad = (n: number) => 'a'.repeat(n);

  test('the cut never leaves part of an e-mail, a secret pair, or a document', () => {
    for (const tail of [
      ' ana@example.com',
      ' token=SEGREDO-LONGO',
      ' CPF 111.444.777-35',
      ' 12.345.678/0001-95',
    ]) {
      for (let shift = 1; shift < tail.length; shift += 1) {
        const out = redactText(pad(MAX_TEXT - shift) + tail);
        expect(out.endsWith('…[truncado]')).toBe(true);
        for (const piece of ['ana@', '@exa', 'SEGREDO', '111.4', '444.7', '12.345', '0001']) {
          expect(out, `${tail} ${shift}`).not.toContain(piece);
        }
      }
    }
  });

  test('the stack cut also drops a partial word', () => {
    const error = new Error('x');
    error.stack = pad(8192 - 6) + ' ana@example.com';
    expect(redactError(error).stack).not.toContain('ana@');
  });

  test('an over-long local part is masked whole', () => {
    expect(redactText(`para ${'b'.repeat(70)}@example.com.`)).toBe('para ***@example.com.');
  });

  test('an address before a dot or punctuation is masked, and a longer domain is not cut', () => {
    expect(redactText('(ana@example.com). ana@ex.com.br; ana@example.com!')).toBe(
      '(***@example.com). ***@ex.com.br; ***@example.com!',
    );
  });

  test('an address in a URL query is dropped or masked', () => {
    expect(redactText('GET https://x.example/p?e=ana@example.com&limit=1 ok')).toBe(
      'GET https://x.example/p?limit=1 ok',
    );
    expect(redactUrl('/api/x?status=ana@example.com')).toBe('/api/x?status=***@example.com');
  });

  test('a secret key in JSON text is masked', () => {
    expect(redactText('{"apiKey": "re_abc", "Authorization":"Bearer x", "id":"i1"}')).toBe(
      '{"apiKey":"***", "Authorization":"***", "id":"i1"}',
    );
  });

  test('argForLog gives only the type of a class instance', () => {
    class Client {
      secretish = 'hunter2';
    }
    expect(argForLog(new Client())).toBe('[Object Client]');
    expect(argForLog([{ to: 'ana@example.com' }])).toBe('[{"to":"***@example.com"}]');
  });
});
