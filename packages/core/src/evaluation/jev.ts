import {performance} from 'node:perf_hooks';
import {createTypeSafeAi} from '@ai-sdk/typesafe-ai';
import {experimental_evaluate} from 'ai';
import {EvaluationError, toEvaluationError} from './errors.js';
import {confidenceSchema, parseEvaluationInput} from './schemas.js';
import {toEvaluationUsage} from './usage.js';
import type {EvaluationInput, EvaluationQuestions, EvaluationResult, JevEvaluator, JevEvaluatorOptions} from './types.js';

const MAX_MODEL_ID_CHARACTERS = 128;

export const DEFAULT_JEV_MODEL_ID = 'jev-latest';
export const DEFAULT_JEV_TIMEOUT_MS = 5_000;
export const MAX_JEV_TIMEOUT_MS = 30_000;

// Read cancellation dynamically; the signal can change while evaluation awaits.
const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

/** Create only after the host has checked the user's JEV opt-in preference. */
export function createJevEvaluator(options: JevEvaluatorOptions): JevEvaluator {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) throw new EvaluationError('missing_credentials', 'Configure a TypeSafe API key through /connect before using JEV.');
  const {modelId, timeoutMs} = evaluatorSettings(options);
  const transport = options.fetch ?? globalThis.fetch;
  const model = createTypeSafeAi({apiKey, fetch: (url, init) => {
    if (requestDestination(url) !== 'https://api.typesafe.ai/v1/systemone') {
      throw new EvaluationError('provider_error', 'JEV attempted an unsupported API destination.');
    }
    return transport(url, {...init, redirect: 'error'});
  }}).evaluationModel(modelId);

  return {evaluate: input => evaluateInput(input, {model, timeoutMs})};
}

function requestDestination(url: Parameters<typeof fetch>[0]): string {
  if (typeof url === 'string') return url;
  if (url instanceof URL) return url.href;
  return '';
}

function evaluatorSettings(options: JevEvaluatorOptions) {
  const modelId = options.modelId ?? DEFAULT_JEV_MODEL_ID;
  const timeoutMs = options.timeoutMs ?? DEFAULT_JEV_TIMEOUT_MS;
  if (typeof modelId !== 'string' || !modelId.trim() || modelId.length > MAX_MODEL_ID_CHARACTERS) {
    throw new EvaluationError('invalid_input', 'Provide a nonblank JEV model ID of at most 128 characters.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_JEV_TIMEOUT_MS) {
    throw new EvaluationError('invalid_input', 'JEV timeout must be an integer from 1 to 30000 milliseconds.');
  }
  return {modelId, timeoutMs};
}

async function evaluateInput<const Questions extends EvaluationQuestions>(input: EvaluationInput<Questions>, context: {model: ReturnType<ReturnType<typeof createTypeSafeAi>['evaluationModel']>; timeoutMs: number}): Promise<EvaluationResult<Questions>> {
  const {model, timeoutMs} = context;
  if (isAborted(input.abortSignal)) throw new EvaluationError('cancelled', 'JEV evaluation cancelled.');
  const parsed = parseEvaluationInput(input);
  const startedAt = performance.now();
  const controller = new AbortController();
  const signal = input.abortSignal ? AbortSignal.any([input.abortSignal, controller.signal]) : controller.signal;
  let timedOut = false;
  const abortError = () => isAborted(input.abortSignal)
    ? new EvaluationError('cancelled', 'JEV evaluation cancelled.')
    : new EvaluationError('timeout', 'JEV evaluation timed out.');
  let onAbort!: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, {once: true});
    if (signal.aborted) onAbort();
  });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);

  try {
    // The race also bounds custom transports that do not honor AbortSignal.
    const result = await Promise.race([experimental_evaluate({model, ...parsed, abortSignal: signal, maxRetries: 0}), interrupted]);
    signal.throwIfAborted();
    return formatEvaluation(result, parsed.questions, startedAt);
  } catch (error) {
    if (isAborted(input.abortSignal)) throw new EvaluationError('cancelled', 'JEV evaluation cancelled.');
    if (timedOut) throw new EvaluationError('timeout', 'JEV evaluation timed out.');
    throw toEvaluationError(error);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    controller.abort();
  }
}

function formatEvaluation<const Questions extends EvaluationQuestions>(result: Awaited<ReturnType<typeof experimental_evaluate<Questions>>>, questions: Questions, startedAt: number): EvaluationResult<Questions> {
  const metadata = result.providerMetadata?.typesafe?.confidence;
  const confidence = metadata === undefined ? undefined : confidenceSchema.safeParse(metadata);
  validateConfidence(confidence, questions);
  validateResponseModel(result.response.modelId);
  const usage = toEvaluationUsage(result.usage);
  return {
    answers: result.answers, modelId: result.response.modelId, durationMs: performance.now() - startedAt,
    ...(usage ? {usage} : {}), ...(result.rounding ? {rounding: result.rounding} : {}),
    ...(confidence?.success === true && Object.keys(confidence.data).length ? {confidence: confidence.data} : {}),
  };
}

function validateConfidence(confidence: ReturnType<typeof confidenceSchema.safeParse> | undefined, questions: EvaluationQuestions) {
  if (confidence && (!confidence.success || Object.keys(confidence.data).some(id => !Object.hasOwn(questions, id) || questions[id].type === 'boolean'))) { // oxlint-disable-line security/detect-object-injection -- Question IDs are checked with Object.hasOwn before reading the validated question record.
    throw new EvaluationError('invalid_response', 'JEV returned invalid evaluation confidence.');
  }
}

function validateResponseModel(modelId: string) {
  if (!modelId.trim() || modelId.length > MAX_MODEL_ID_CHARACTERS) throw new EvaluationError('invalid_response', 'JEV returned an invalid model ID.');
}
