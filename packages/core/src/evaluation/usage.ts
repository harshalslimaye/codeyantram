import {tokenUsageSchema, type TokenUsage} from '@codeyantram/shared';
import type {Experimental_EvaluationResult} from 'ai';
import type {EvaluationQuestions} from './types.js';
import {EvaluationError} from './errors.js';

/** Evaluation usage is separate from chat usage; missing counts remain absent. */
export function toEvaluationUsage(usage: Experimental_EvaluationResult<EvaluationQuestions>['usage']): TokenUsage | undefined {
  const counts = Object.fromEntries(Object.entries(usage).filter(([, value]) => value !== undefined));
  if (Object.keys(counts).length === 0) return undefined;
  const parsed = tokenUsageSchema.safeParse(counts);
  if (!parsed.success) throw new EvaluationError('invalid_response', 'JEV returned invalid token usage.');
  return parsed.data;
}
