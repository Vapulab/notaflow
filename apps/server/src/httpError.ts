import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'HttpError';
  }
}

export function handleError(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof HttpError) {
    return reply.status(error.status).send({
      error: error.code,
      ...(error.detail ? { detail: error.detail } : {}),
      ...error.extra,
    });
  }
  // A route can throw any value, not only an Error.
  const status =
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;
  if (status < 500) {
    return reply.status(status).send({ error: 'bad_request', detail: String(error.message) });
  }
  reply.log.error({ err: error }, 'unhandled error');
  return reply.status(500).send({ error: 'internal_error' });
}
