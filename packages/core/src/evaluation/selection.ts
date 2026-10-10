import type {EvaluationMetadata, JevCapability} from './types.js';

export const MAX_OBJECTIVE_CHARACTERS = 2048;

export function evaluationCapability(jev?: JevCapability, enabled?: boolean):
  | Extract<JevCapability, {status: 'available'}>
  | {status: 'skipped'; reason: 'disabled_for_request' | 'disabled' | 'missing_credentials' | 'initialization_failed'} {
  if (enabled === false) return {status: 'skipped', reason: 'disabled_for_request'};
  if (!jev || jev.status === 'disabled') return {status: 'skipped', reason: 'disabled'};
  if (jev.status === 'unavailable') return {status: 'skipped', reason: jev.reason};
  return jev;
}

export function evaluationObjective(objective?: string): string | undefined {
  const normalized = objective?.trim().slice(0, MAX_OBJECTIVE_CHARACTERS);
  return normalized === '' ? undefined : normalized;
}

export function retainUncertainEvidence(probability: number | undefined, cutoff: number): boolean {
  return probability === undefined || probability >= cutoff;
}

export function evaluationStatus(total: number, evaluated: number): EvaluationMetadata['status'] {
  if (evaluated === 0) return 'failed';
  return evaluated < total ? 'partial' : 'completed';
}
