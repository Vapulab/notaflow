import type { R2Settings } from '@notaflow/r2';

export interface WorkerConfig {
  redisUrl: string;
  r2: R2Settings;
  concurrency: 2;
}

export function loadWorkerConfig(env: Record<string, string | undefined>): WorkerConfig {
  const names = [
    'REDIS_URL',
    'R2_ACCOUNT_ID',
    'R2_DANFSE_ACCESS_KEY_ID',
    'R2_DANFSE_SECRET_ACCESS_KEY',
    'R2_DANFSE_BUCKET',
  ];
  const [redisUrl = '', accountId = '', accessKeyId = '', secretAccessKey = '', bucket = ''] =
    names.map((n) => env[n] || '');
  const problems = names
    .filter((_, i) => ![redisUrl, accountId, accessKeyId, secretAccessKey, bucket][i])
    .map((n) => `${n} is required`);
  if (redisUrl && (!URL.canParse(redisUrl) || new URL(redisUrl).protocol !== 'redis:')) {
    problems.push('REDIS_URL must be a redis: URL');
  }
  if (accountId && !/^[0-9a-f]{32}$/.test(accountId)) {
    problems.push('R2_ACCOUNT_ID must be the 32-character Cloudflare account id');
  }
  if (bucket && !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
    problems.push('R2_DANFSE_BUCKET must be a bucket name: lowercase letters, digits, and hyphens');
  }
  if (problems.length > 0)
    throw new Error(`Invalid worker configuration:\n- ${problems.join('\n- ')}`);
  return { redisUrl, r2: { accountId, accessKeyId, secretAccessKey, bucket }, concurrency: 2 };
}
