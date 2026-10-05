import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  createJevEvaluator, EvaluationError, MAX_EVALUATION_INPUT_BYTES, MAX_EVALUATION_QUESTIONS,
  type EvaluationInput, type EvaluationQuestions,
} from '@codeyantram/core';

const apiKey = 'test-typesafe-key';
const input = {state: {task: 'Find the API signature', chunk: 'export function fetchPage(url: string)'},
  questions: {relevant: {type: 'boolean', instructions: 'Does the chunk contain evidence useful to the task?'}}} as const;

function response(overrides: Record<string, unknown> = {}) {
  return Response.json({model: 'jev-1.13.0', answers: {relevant: {type: 'noul', noul: 0.91}},
    usage: {input_tokens: 10, output_tokens: 2}, ...overrides});
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => {resolve = yes;});
  return {promise, resolve};
}

afterEach(() => { vi.useRealTimers(); });

describe('JEV evaluation provider', () => {
  it('sends a typed batch to the evaluation endpoint and returns normalized answers and usage', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({private: apiKey}));
    const result = await createJevEvaluator({apiKey: ` ${apiKey} `, fetch}).evaluate(input);
    expect(result).toEqual({
      answers: {relevant: {type: 'boolean', probability: 0.91}}, modelId: 'jev-1.13.0', durationMs: expect.any(Number),
      usage: {inputTokens: 10, outputTokens: 2, totalTokens: 12}, rounding: {probabilityDecimals: 2, scoreDecimals: 2},
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('https://api.typesafe.ai/v1/systemone');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${apiKey}`);
    expect(JSON.parse(String(init?.body))).toEqual({model: 'jev-latest', state: input.state,
      questions: {relevant: {...input.questions.relevant, type: 'noul'}}});
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(result).not.toHaveProperty('response');
    expect(init?.signal?.aborted).toBe(true);
  });

  it('preserves Boolean probability, Choice/Score distributions, and separate confidence', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({answers: {
      relevant: {type: 'noul', noul: 0.5},
      action: {type: 'choice', choice: 'retain', probabilities: {retain: 0.8, discard: 0.2}, confidence: 0.6},
      strength: {type: 'score', score: 1.6, probabilities: {'0': 0.1, '1': 0.2, '2': 0.7}, confidence: 0.7},
    }}));
    const questions = {...input.questions,
      action: {type: 'choice', instructions: 'Which action fits?', criteria: {retain: ['Useful evidence'], discard: null}},
      strength: {type: 'score', instructions: 'How direct is the evidence?', criteria: ['None', 'Indirect', 'Direct']},
    } as const;
    const result = await createJevEvaluator({apiKey, fetch}).evaluate({...input, questions});
    expect(result.answers.relevant.probability).toBe(0.5);
    expect(result.answers.action).toEqual({type: 'choice', choice: 'retain', probabilities: {retain: 0.8, discard: 0.2}});
    expect(result.answers.strength).toEqual({type: 'score', score: 1.6, probabilities: {'0': 0.1, '1': 0.2, '2': 0.7}});
    expect(result.confidence).toEqual({action: 0.6, strength: 0.7});
    expect(result.confidence).not.toHaveProperty('relevant');
  });

  it('accepts provider rounding rather than requiring exact distribution sums', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({answers: {
      level: {type: 'score', score: 1, probabilities: {'0': 0.33, '1': 0.33, '2': 0.33}},
    }}));
    const result = await createJevEvaluator({apiKey, fetch, modelId: 'jev-pinned-version'}).evaluate({state: 'Evidence',
      questions: {level: {type: 'score', instructions: 'Rate the evidence', criteria: ['None', 'Some', 'Direct']}}});
    expect(result.answers.level.score).toBe(1);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).model).toBe('jev-pinned-version');
  });

  it.each([undefined, null, {input_tokens: 7}, {output_tokens: 0}])('preserves absent and partial usage: %j', async usage => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({usage}));
    const result = await createJevEvaluator({apiKey, fetch}).evaluate(input);
    if (usage == null) expect(result).not.toHaveProperty('usage');
    else if ('input_tokens' in usage) expect(result.usage).toEqual({inputTokens: 7});
    else expect(result.usage).toEqual({outputTokens: 0});
  });

  it('snapshots the request so caller mutations cannot change answer validation', async () => {
    const pending = deferred<Response>();
    const started = deferred<void>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => {started.resolve(); return pending.promise;});
    const mutable = {state: {chunk: 'Original'}, questions: {relevant: {type: 'boolean' as const, instructions: 'Relevant?'}}};
    const result = createJevEvaluator({apiKey, fetch}).evaluate(mutable);
    await started.promise;
    mutable.state.chunk = 'Changed';
    delete (mutable.questions as Partial<typeof mutable.questions>).relevant;
    pending.resolve(response());
    await expect(result).resolves.toMatchObject({answers: {relevant: {probability: 0.91}}});
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).state).toEqual({chunk: 'Original'});
  });
});

describe('JEV input and failure handling', () => {
  it('requires an explicit key rather than using an environment key', () => {
    vi.stubEnv('TYPESAFE_AI_API_KEY', 'environment-key');
    expect(() => createJevEvaluator({apiKey: ' '})).toThrowError(expect.objectContaining({code: 'missing_credentials'}));
  });

  it.each([{timeoutMs: 0}, {timeoutMs: 30_001}, {timeoutMs: 1.5}, {modelId: ' '}, {modelId: 'x'.repeat(129)}])
  ('rejects invalid evaluator options: %j', options => {
    expect(() => createJevEvaluator({apiKey, ...options})).toThrowError(expect.objectContaining({code: 'invalid_input'}));
  });

  it.each([
    {state: 'text', questions: {}},
    {state: 123, questions: input.questions},
    {state: 'text', questions: {' ': input.questions.relevant}},
    {state: {invalid: undefined}, questions: input.questions},
    {state: 'text', questions: {relevant: {type: 'boolean', instructions: ' '}}},
    {state: 'text', questions: {relevant: {type: 'boolean', instructions: 'Relevant?', criteria: {unknown: 'invalid'}}}},
    {state: 'text', questions: {relevant: {type: 'choice', instructions: 'Choose', criteria: {}}}},
    {state: 'text', questions: {relevant: {type: 'choice', instructions: 'Choose', criteria: Object.fromEntries(Array.from({length: 256}, (_, i) => [i, null]))}}},
    {state: 'text', questions: {relevant: {type: 'score', instructions: 'Rate', criteria: ['Only']}}},
    {state: 'text', questions: {relevant: {type: 'score', instructions: 'Rate', criteria: Array(11).fill('Level')}}},
    {state: 'text', questions: Object.fromEntries(Array.from({length: MAX_EVALUATION_QUESTIONS + 1}, (_, i) => [i, input.questions.relevant]))},
    {state: '🙂'.repeat(Math.floor(MAX_EVALUATION_INPUT_BYTES / 4) + 1), questions: input.questions},
  ])('rejects invalid or oversized batches before making a request (case %#)', async invalid => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(createJevEvaluator({apiKey, fetch}).evaluate(invalid as unknown as EvaluationInput<EvaluationQuestions>))
      .rejects.toMatchObject({code: 'invalid_input'});
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([[401, 'authentication_failed'], [403, 'authentication_failed'], [429, 'rate_limited'], [500, 'provider_error'], [529, 'provider_error']] as const)
  ('sanitizes HTTP %s without retrying', async (status, code) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({message: `private-state ${apiKey}`}, {status}));
    const error = await createJevEvaluator({apiKey, fetch}).evaluate(input).catch(error => error);
    expect(error).toBeInstanceOf(EvaluationError);
    expect(error.code).toBe(code);
    expect(`${error.message} ${JSON.stringify(error)}`).not.toMatch(/private-state|test-typesafe-key/);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    {}, {relevant: {type: 'noul', noul: -0.1}}, {relevant: {type: 'noul', noul: 1.1}},
    {relevant: {type: 'noul', noul: 'private-state'}},
    {relevant: {type: 'noul', noul: 0.9}, unknown: {type: 'noul', noul: 0.1}},
    {relevant: {type: 'choice', choice: 'unknown', probabilities: {unknown: 1}}},
  ])('rejects missing, extra, malformed, or mismatched answers: %j', async answers => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({answers}));
    await expect(createJevEvaluator({apiKey, fetch}).evaluate(input)).rejects.toMatchObject({code: 'invalid_response'});
  });

  it('rejects invalid Choice distributions and confidence', async () => {
    const request = {state: 'text', questions: {action: {type: 'choice', instructions: 'Choose', criteria: {a: null, b: null}}}} as const;
    for (const answer of [
      {type: 'choice', choice: 'a', probabilities: {a: 0.3, b: 0.7}},
      {type: 'choice', choice: 'a', probabilities: {a: 0.8}},
      {type: 'choice', choice: 'a', probabilities: {a: 0.9, b: 0.9}},
      {type: 'choice', choice: 'a', probabilities: {a: 0.8, b: 0.2}, confidence: 1.1},
    ]) {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({answers: {action: answer}}));
      await expect(createJevEvaluator({apiKey, fetch}).evaluate(request)).rejects.toMatchObject({code: 'invalid_response'});
    }
  });

  it.each([{usage: {input_tokens: -1}}, {usage: {output_tokens: 1.5}}, {model: ''}])('rejects invalid result metadata: %j', async invalid => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(invalid));
    await expect(createJevEvaluator({apiKey, fetch}).evaluate(input)).rejects.toMatchObject({code: 'invalid_response'});
  });

  it('sanitizes malformed JSON and transport failures', async () => {
    for (const fetch of [
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(`{broken private-state ${apiKey}`)),
      vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error(`private-state ${apiKey}`)),
    ]) {
      const error = await createJevEvaluator({apiKey, fetch}).evaluate(input).catch(error => error);
      expect(error).toBeInstanceOf(EvaluationError);
      expect(`${error.message} ${JSON.stringify(error)}`).not.toMatch(/private-state|test-typesafe-key/);
      expect(fetch).toHaveBeenCalledOnce();
    }
  });
});

describe('JEV cancellation and deadlines', () => {
  it('makes no request if already cancelled', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(createJevEvaluator({apiKey, fetch}).evaluate({...input, abortSignal: AbortSignal.abort()}))
      .rejects.toMatchObject({code: 'cancelled'});
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])('cancels pending evaluation and ignores a late response (late=%s)', async late => {
    const controller = new AbortController();
    const pending = deferred<Response>();
    const started = deferred<void>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => {started.resolve(); return pending.promise;});
    const result = createJevEvaluator({apiKey, fetch}).evaluate({...input, abortSignal: controller.signal});
    const checked = expect(result).rejects.toMatchObject({code: 'cancelled'});
    await started.promise;
    controller.abort(new Error(`private-reason ${apiKey}`));
    if (late) pending.resolve(response());
    await checked;
    expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  });

  it('enforces its deadline even if the transport ignores cancellation and clears the timer', async () => {
    vi.useFakeTimers();
    const started = deferred<void>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => {started.resolve(); return new Promise(() => {});});
    const result = createJevEvaluator({apiKey, fetch, timeoutMs: 20}).evaluate(input);
    const checked = expect(result).rejects.toMatchObject({code: 'timeout'});
    await started.promise;
    await vi.advanceTimersByTimeAsync(20);
    await checked;
    expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels one concurrent evaluation without aborting another', async () => {
    const controller = new AbortController();
    const pending = [deferred<Response>(), deferred<Response>()];
    const bothStarted = deferred<void>();
    let calls = 0;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => {
      const index = calls++;
      if (calls === 2) bothStarted.resolve();
      return pending[index]!.promise;
    });
    const evaluator = createJevEvaluator({apiKey, fetch});
    const first = evaluator.evaluate({...input, abortSignal: controller.signal});
    const checked = expect(first).rejects.toMatchObject({code: 'cancelled'});
    const second = evaluator.evaluate(input);
    await bothStarted.promise;
    controller.abort();
    await checked;
    expect(fetch.mock.calls[1]![1]?.signal?.aborted).toBe(false);
    pending[1]!.resolve(response());
    await expect(second).resolves.toMatchObject({answers: {relevant: {probability: 0.91}}});
  });
});
