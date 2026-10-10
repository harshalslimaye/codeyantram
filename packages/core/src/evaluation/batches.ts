import type {TokenUsage} from '@codeyantram/shared';
import {abortable, deadline} from './cancellation.js';
import type {EvaluationInput, EvaluationQuestions, JevEvaluator} from './types.js';

export const DEFAULT_EVALUATION_BATCH_SIZE = 8;
export const DEFAULT_EVALUATION_CONCURRENCY = 2;
export const DEFAULT_EVALUATION_TIMEOUT_MS = 5000;

export function recordEvaluationUsage(result: TokenUsage | undefined, usage: TokenUsage) {
  const totals = new Map(Object.entries(usage));
  for (const [key, value] of Object.entries(result ?? {})) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) totals.set(key, (totals.get(key) ?? 0) + value);
  }
  Object.assign(usage, Object.fromEntries(totals));
}

function recordAnswers(candidates: {id: string}[], result: Awaited<ReturnType<JevEvaluator['evaluate']>>, judgments: Map<string, number>) {
  for (const candidate of candidates) {
    const answer = result.answers[candidate.id];
    if (answer?.type === 'boolean' && Number.isFinite(answer.probability) && answer.probability >= 0 && answer.probability <= 1) {
      judgments.set(candidate.id, answer.probability);
    }
  }
}

export async function evaluateCandidates<Candidate extends {id: string}>(
  candidates: Candidate[], evaluator: JevEvaluator, options: {
    buildInput: (batch: Candidate[]) => Omit<EvaluationInput<EvaluationQuestions>, 'abortSignal'>;
    signal?: AbortSignal;
    batchSize?: number;
    concurrency?: number;
    timeoutMs?: number;
  },
): Promise<{judgments: Map<string, number>; usage: TokenUsage}> {
  const batchSize = options.batchSize ?? DEFAULT_EVALUATION_BATCH_SIZE;
  const concurrency = options.concurrency ?? DEFAULT_EVALUATION_CONCURRENCY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_EVALUATION_TIMEOUT_MS;
  for (const value of [batchSize, concurrency, timeoutMs]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Evaluation budgets must be positive safe integers.');
  }
  options.signal?.throwIfAborted();
  const judgments = new Map<string, number>();
  const usage: TokenUsage = {};
  const scope = deadline(timeoutMs, options.signal);
  let next = 0;
  const worker = async () => {
    while (next < candidates.length && !scope.signal.aborted) {
      const batch = candidates.slice(next, next += batchSize);
      try {
        const result = await abortable(evaluator.evaluate({...options.buildInput(batch), abortSignal: scope.signal}), scope.signal);
        recordAnswers(batch, result, judgments);
        recordEvaluationUsage(result.usage, usage);
      } catch {
        continue;
      }
    }
  };
  try { await Promise.all(Array.from({length: Math.min(concurrency, Math.ceil(candidates.length / batchSize))}, worker)); }
  finally { scope.dispose(); }
  options.signal?.throwIfAborted();
  return {judgments, usage};
}
