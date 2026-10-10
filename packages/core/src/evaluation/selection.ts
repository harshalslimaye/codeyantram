import {performance} from 'node:perf_hooks';
import type {TokenUsage} from '@codeyantram/shared';
import type {EvaluationMetadata, JevCapability, JevEvaluator} from './types.js';

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

export function evaluationSetup(options: {
  jev?: JevCapability; enabled?: boolean; objective?: string;
  small?: {when: () => boolean; reason: string; beforeObjective?: boolean};
}): {status: 'ready'; evaluator: JevEvaluator; objective: string} | {status: 'skipped'; reason: string} {
  const capability = evaluationCapability(options.jev, options.enabled);
  if (capability.status === 'skipped') return capability;
  if (options.small?.beforeObjective === true && options.small.when()) return {status: 'skipped', reason: options.small.reason};
  const objective = evaluationObjective(options.objective);
  if (objective === undefined) return {status: 'skipped', reason: 'no_objective'};
  if (options.small?.beforeObjective !== true && options.small?.when() === true) return {status: 'skipped', reason: options.small.reason};
  return {status: 'ready', evaluator: capability.evaluator, objective};
}

export function candidateEvaluationMetadata<Mode extends 'filter' | 'rank'>(total: number, mode: Mode) {
  return {status: 'skipped' as const, mode, totalCandidates: total,
    evaluatedCandidates: 0, retainedCandidates: total, incomplete: false};
}

export function chunkEvaluationMetadata(total: number) {
  return {status: 'skipped' as const, totalChunks: total,
    evaluatedChunks: 0, retainedChunks: total, incomplete: false};
}

export function skippedEvaluation<Metadata extends EvaluationMetadata>(
  filtering: Metadata, reason: string, unavailableWarning: string,
): {filtering: Metadata; warnings: string[]} {
  const warnings = reason === 'missing_credentials' || reason === 'initialization_failed' ? [unavailableWarning] : [];
  return {filtering: {...filtering, reason}, warnings};
}

export function recordEvaluationMetadata(
  metadata: EvaluationMetadata & ({totalCandidates: number; evaluatedCandidates: number} | {totalChunks: number; evaluatedChunks: number}),
  result: {judgments: Map<string, number>; usage: TokenUsage}, started: number,
) {
  const evaluated = result.judgments.size;
  const total = 'totalCandidates' in metadata ? metadata.totalCandidates : metadata.totalChunks;
  metadata.status = evaluationStatus(total, evaluated);
  if ('evaluatedCandidates' in metadata) metadata.evaluatedCandidates = evaluated;
  else metadata.evaluatedChunks = evaluated;
  metadata.incomplete = evaluated < total;
  metadata.durationMs = performance.now() - started;
  if (Object.keys(result.usage).length > 0) metadata.usage = result.usage;
}

export function retainUncertainEvidence(probability: number | undefined, cutoff: number): boolean {
  return probability === undefined || probability >= cutoff;
}

export function evaluationStatus(total: number, evaluated: number): EvaluationMetadata['status'] {
  if (evaluated === 0) return 'failed';
  return evaluated < total ? 'partial' : 'completed';
}
