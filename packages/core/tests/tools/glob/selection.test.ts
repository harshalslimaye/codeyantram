import {afterEach, describe, expect, it, vi} from 'vitest';
import {rankGlobFiles} from '../../../src/tools/glob/selection.js';
import type {EvaluationInput, EvaluationQuestions, EvaluationResult, JevEvaluator, JevCapability} from '../../../src/index.js';

type Evaluate = (input: EvaluationInput<EvaluationQuestions>) => Promise<EvaluationResult<EvaluationQuestions>>;
const files = ['src/a.ts', 'src/target.ts', 'tests/test.ts'];
const options = {objective: 'Find relevant implementation', pattern: '**/*.ts'};
function setup(evaluate?: Evaluate) {
  const mock = vi.fn<Evaluate>(evaluate ?? (async () => ({modelId: 'fixture', durationMs: 1, usage: {inputTokens: 10}, answers: {
    'file-0': {type: 'boolean', probability: 0.1}, 'file-1': {type: 'boolean', probability: 0.9}, 'file-2': {type: 'boolean', probability: 0.01},
  }})));
  const jev: JevCapability = {status: 'available', evaluator: {evaluate: mock} as JevEvaluator};
  return {mock, jev};
}
afterEach(() => vi.useRealTimers());

describe('glob JEV ranking', () => {
  it('ranks naming relevance without discarding paths or reading contents', async () => {
    const {jev, mock} = setup();
    const result = await rankGlobFiles(files, {...options, jev});
    expect(result.files).toEqual([files[1], files[0], files[2]]);
    expect(result.filtering).toMatchObject({mode: 'rank', status: 'completed', retainedCandidates: 3, evaluatedCandidates: 3, usage: {inputTokens: 10}});
    expect(mock.mock.calls[0]?.[0].state).toEqual({objective: options.objective, pattern: options.pattern,
      files: files.map((filePath, position) => ({id: `file-${position}`, filePath}))});
  });

  it('keeps missing and invalid judgments in original positions', async () => {
    const {jev} = setup(async () => ({modelId: 'fixture', durationMs: 1, answers: {
      'file-0': {type: 'boolean', probability: 0.1}, 'file-1': {type: 'boolean', probability: 5}, 'file-2': {type: 'boolean', probability: 0.9},
    }}));
    expect(await rankGlobFiles(files, {...options, jev})).toMatchObject({files: [files[2], files[1], files[0]], filtering: {status: 'partial', evaluatedCandidates: 2, incomplete: true}});
  });

  it('keeps all-negative paths and caps evaluated candidates', async () => {
    const {jev, mock} = setup(async input => ({modelId: 'fixture', durationMs: 1,
      answers: Object.fromEntries(Object.keys(input.questions).map(id => [id, {type: 'boolean', probability: 0}])),
    }));
    const many = Array.from({length: 50}, (_, position) => `file-${position}.ts`);
    expect(await rankGlobFiles(many, {...options, jev})).toMatchObject({files: many, filtering: {status: 'partial', evaluatedCandidates: 32, retainedCandidates: 50, incomplete: true}, warnings: []});
    expect(mock).toHaveBeenCalledTimes(4);
  });

  it('honors host capability, per-request bypass, missing objectives, and small results', async () => {
    const {jev, mock} = setup();
    expect((await rankGlobFiles(files, options)).filtering.reason).toBe('disabled');
    expect((await rankGlobFiles(files, {...options, jev, filter: false})).filtering.reason).toBe('disabled_for_request');
    expect((await rankGlobFiles(files, {pattern: '*', jev})).filtering.reason).toBe('no_objective');
    expect((await rankGlobFiles([], {...options, jev})).filtering.reason).toBe('small_result');
    expect((await rankGlobFiles(files, {...options, jev: {status: 'unavailable', reason: 'missing_credentials'}})).filtering.reason).toBe('missing_credentials');
    expect(mock).not.toHaveBeenCalled();
  });

  it('fails open without exposing provider errors', async () => {
    const {jev} = setup(async () => {throw new Error('PRIVATE KEY');});
    const result = await rankGlobFiles(files, {...options, jev});
    expect(result).toMatchObject({files, filtering: {status: 'failed', retainedCandidates: 3}});
    expect(JSON.stringify(result)).not.toContain('PRIVATE KEY');
  });

  it('bounds evaluation latency and propagates caller cancellation', async () => {
    vi.useFakeTimers();
    const {jev} = setup(() => new Promise(() => {}));
    const pending = rankGlobFiles(files, {...options, jev});
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({files, filtering: {status: 'failed'}});
    const controller = new AbortController();
    const cancelled = rankGlobFiles(files, {...options, jev, signal: controller.signal});
    controller.abort(new Error('stop'));
    await expect(cancelled).rejects.toThrow('stop');
    expect(vi.getTimerCount()).toBe(0);
  });
});
