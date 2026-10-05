import type {experimental_evaluate, Experimental_EvaluationQuestion, Experimental_EvaluationResult} from 'ai';
import type {TokenUsage} from '@codeyantram/shared';

export type EvaluationQuestion = Experimental_EvaluationQuestion;
export type EvaluationQuestions = Record<string, EvaluationQuestion>;
export type EvaluationState = Parameters<typeof experimental_evaluate>[0]['state'];

export interface EvaluationInput<Questions extends EvaluationQuestions> {
  state: EvaluationState;
  questions: Questions;
  abortSignal?: AbortSignal;
}

/** Keep typed answers and usage, without exposing raw responses or credentials. */
export interface EvaluationResult<Questions extends EvaluationQuestions> {
  answers: Experimental_EvaluationResult<Questions>['answers'];
  modelId: string;
  durationMs: number;
  usage?: TokenUsage;
  rounding?: Experimental_EvaluationResult<Questions>['rounding'];
  confidence?: Record<string, number>;
}

export interface JevEvaluator {
  evaluate<const Questions extends EvaluationQuestions>(input: EvaluationInput<Questions>): Promise<EvaluationResult<Questions>>;
}

/** The host supplies credentials; core never reads configuration or environment keys. */
export interface JevEvaluatorOptions {
  apiKey: string;
  modelId?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}
