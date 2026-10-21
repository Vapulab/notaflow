import type { Environment } from './types';

// nt004: NT 004 v2.0, schemas/; nt009: NT 009 release 1, schemas/nt009/. Both keep versao 1.01.
export type DpsLayout = 'nt004' | 'nt009';

// CGNFS-e comunicado of 2026-10-20: produção restrita has release 1 from that day, production from 2026-12-01.
const NT009_FROM: Record<Environment, number> = {
  producao_restrita: Date.parse('2026-10-20T00:00:00-03:00'),
  producao: Date.parse('2026-12-01T00:00:00-03:00'),
};

export function dpsLayout(environment: Environment, issuedAt: Date): DpsLayout {
  return issuedAt.getTime() >= NT009_FROM[environment] ? 'nt009' : 'nt004';
}
