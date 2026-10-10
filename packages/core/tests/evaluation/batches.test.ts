import {afterEach, describe, expect, it, vi} from 'vitest';
import {evaluateCandidates, evaluationCapability, evaluationObjective, evaluationStatus, retainUncertainEvidence} from '../../src/evaluation/index.js';
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
