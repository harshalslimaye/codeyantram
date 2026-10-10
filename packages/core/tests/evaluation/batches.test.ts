import {afterEach, describe, expect, it, vi} from 'vitest';
import {candidateEvaluationMetadata, chunkEvaluationMetadata, evaluateCandidates, evaluationCapability, evaluationObjective,
  evaluationSetup, evaluationStatus, recordEvaluationMetadata, retainUncertainEvidence, skippedEvaluation} from '../../src/evaluation/index.js';
import type {EvaluationInput, EvaluationQuestions, EvaluationResult, JevEvaluator} from '../../src/evaluation/index.js';

type Evaluate = (input: EvaluationInput<EvaluationQuestions>) => Promise<EvaluationResult<EvaluationQuestions>>;
const candidates = [{id: 'first'}, {id: 'second'}, {id: 'third'}];
const buildInput = (batch: {id: string}[]) => ({
  state: {symbols: batch},
  questions: Object.fromEntries(batch.map(candidate => [candidate.id, {type: 'boolean' as const, instructions: 'Relevant to the task?'}])),
});
const evaluator = (evaluate: Evaluate) => ({evaluate} as JevEvaluator);

afterEach(() => vi.useRealTimers());

describe('shared candidate evaluation', () => {
  it('batches domain-neutral candidates and aggregates validated judgments and usage', async () => {
    const evaluate = vi.fn<Evaluate>(async input => ({modelId: 'fixture', durationMs: 1,
      answers: Object.fromEntries(Object.keys(input.questions).map(id => [id, {type: 'boolean', probability: 0.8}])),
      usage: {inputTokens: 10, outputTokens: 2},
    }));
    const result = await evaluateCandidates(candidates, evaluator(evaluate), {buildInput, batchSize: 2, concurrency: 1});
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect([...result.judgments]).toEqual(candidates.map(candidate => [candidate.id, 0.8]));
    expect(result.usage).toEqual({inputTokens: 20, outputTokens: 4});
  });

  it('leaves failed, missing, and invalid judgments absent', async () => {
    const evaluate = vi.fn<Evaluate>()
      .mockRejectedValueOnce(new Error('provider failure'))
      .mockResolvedValueOnce({modelId: 'fixture', durationMs: 1, answers: {second: {type: 'boolean', probability: 2}}})
      .mockResolvedValueOnce({modelId: 'fixture', durationMs: 1, answers: {}});
    const result = await evaluateCandidates(candidates, evaluator(evaluate), {buildInput, batchSize: 1, concurrency: 1});
    expect(result.judgments.size).toBe(0);
    expect(evaluate).toHaveBeenCalledTimes(3);
  });

  it('bounds concurrency', async () => {
    let active = 0;
    let peak = 0;
    const evaluate: Evaluate = async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return {modelId: 'fixture', durationMs: 1, answers: {}};
    };
    await evaluateCandidates(candidates, evaluator(evaluate), {buildInput, batchSize: 1, concurrency: 2});
    expect(peak).toBe(2);
  });

  it('times out even when the evaluator ignores cancellation', async () => {
    vi.useFakeTimers();
    const pending = evaluateCandidates(candidates, evaluator(() => new Promise(() => {})), {buildInput, timeoutMs: 10});
    await vi.advanceTimersByTimeAsync(10);
    expect((await pending).judgments.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates caller cancellation', async () => {
    const controller = new AbortController();
    const pending = evaluateCandidates(candidates, evaluator(() => new Promise(() => {})), {buildInput, signal: controller.signal});
    controller.abort(new Error('stop'));
    await expect(pending).rejects.toThrow('stop');
  });

  it('rejects invalid execution budgets', async () => {
    await expect(evaluateCandidates(candidates, evaluator(vi.fn()), {buildInput, batchSize: 0})).rejects.toThrow(RangeError);
  });
});

describe('shared relevance policy', () => {
  it('resolves opt-in without tool-specific assumptions', () => {
    expect(evaluationCapability()).toEqual({status: 'skipped', reason: 'disabled'});
    expect(evaluationCapability({status: 'unavailable', reason: 'missing_credentials'})).toEqual({status: 'skipped', reason: 'missing_credentials'});
    expect(evaluationCapability({status: 'available', evaluator: evaluator(vi.fn())}, false)).toEqual({status: 'skipped', reason: 'disabled_for_request'});
  });

  it('normalizes objectives and reports incomplete judgments', () => {
    expect(evaluationObjective('  task  ')).toBe('task');
    expect(evaluationObjective('   ')).toBeUndefined();
    expect(evaluationStatus(3, 0)).toBe('failed');
    expect(evaluationStatus(3, 2)).toBe('partial');
    expect(evaluationStatus(3, 3)).toBe('completed');
    expect(retainUncertainEvidence(undefined, 0.05)).toBe(true);
    expect(retainUncertainEvidence(0.01, 0.05)).toBe(false);
  });
});

describe('shared evaluation setup and metadata', () => {
  it('preserves capability, objective, and size-check precedence', () => {
    const jev = {status: 'available' as const, evaluator: evaluator(vi.fn())};
    const when = vi.fn<() => boolean>(() => true);
    expect(evaluationSetup({jev, enabled: false, objective: ' ', small: {when, reason: 'small_result'}}))
      .toEqual({status: 'skipped', reason: 'disabled_for_request'});
    expect(when).not.toHaveBeenCalled();
    expect(evaluationSetup({jev, objective: ' ', small: {when, reason: 'small_result'}}))
      .toEqual({status: 'skipped', reason: 'no_objective'});
    expect(when).not.toHaveBeenCalled();
    expect(evaluationSetup({jev, objective: ' ', small: {when, reason: 'small_result', beforeObjective: true}}))
      .toEqual({status: 'skipped', reason: 'small_result'});
    expect(when).toHaveBeenCalledOnce();
    expect(evaluationSetup({jev, objective: ' task ', small: {when: () => false, reason: 'small_result'}}))
      .toEqual({status: 'ready', evaluator: jev.evaluator, objective: 'task'});
  });

  it('records candidate and chunk counts without adding empty usage', () => {
    const candidateMetadata = candidateEvaluationMetadata(3, 'rank');
    recordEvaluationMetadata(candidateMetadata, {judgments: new Map([['first', 0.8]]), usage: {}}, performance.now());
    expect(candidateMetadata).toMatchObject({status: 'partial', mode: 'rank', totalCandidates: 3,
      evaluatedCandidates: 1, retainedCandidates: 3, incomplete: true});
    expect(candidateMetadata).not.toHaveProperty('usage');

    const chunks = chunkEvaluationMetadata(2);
    recordEvaluationMetadata(chunks, {judgments: new Map([['first', 0.8], ['second', 0.9]]), usage: {inputTokens: 3}}, performance.now());
    expect(chunks).toMatchObject({status: 'completed', totalChunks: 2,
      evaluatedChunks: 2, retainedChunks: 2, incomplete: false, usage: {inputTokens: 3}});
  });

  it('adds warnings only when evaluation is unavailable', () => {
    const filtering = candidateEvaluationMetadata(2, 'rank');
    expect(skippedEvaluation(filtering, 'no_objective', 'unavailable')).toEqual({
      filtering: {...filtering, reason: 'no_objective'}, warnings: [],
    });
    expect(skippedEvaluation(filtering, 'missing_credentials', 'unavailable')).toEqual({
      filtering: {...filtering, reason: 'missing_credentials'}, warnings: ['unavailable'],
    });
    expect(skippedEvaluation(filtering, 'initialization_failed', 'unavailable').warnings).toEqual(['unavailable']);
    expect(filtering).not.toHaveProperty('reason');
  });
});
