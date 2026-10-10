import {afterEach, describe, expect, it, vi} from 'vitest';
import {rankGrepMatches} from '../../../src/tools/grep/selection.js';
import type {GrepMatch, EvaluationInput, EvaluationQuestions, EvaluationResult, JevEvaluator, JevCapability} from '../../../src/index.js';

type Evaluate = (input: EvaluationInput<EvaluationQuestions>) => Promise<EvaluationResult<EvaluationQuestions>>;
const matches: GrepMatch[] = Array.from({length: 3}, (_, position) => ({filePath: 'file.ts', line: position + 1,
  column: 1, text: `needle ${position}`, textStartColumn: 1, textTruncated: false}));
const options = {objective: 'Find relevant implementation', pattern: 'needle'};
function setup(evaluate?: Evaluate) {
  const mock = vi.fn<Evaluate>(evaluate ?? (async () => ({modelId: 'fixture', durationMs: 1, usage: {inputTokens: 10}, answers: {
    'match-0': {type: 'boolean', probability: 0.1}, 'match-1': {type: 'boolean', probability: 0.9}, 'match-2': {type: 'boolean', probability: 0.01},
  }})));
  const jev: JevCapability = {status: 'available', evaluator: {evaluate: mock} as JevEvaluator};
  return {mock, jev};
}
afterEach(() => vi.useRealTimers());

describe('grep JEV ranking', () => {
  it('ranks relevance without dropping matches or changing source locations', async () => {
    const {jev, mock} = setup();
    const result = await rankGrepMatches(matches, {...options, jev});
    expect(result.matches).toEqual([matches[1], matches[0], matches[2]]);
    expect(result.filtering).toMatchObject({mode: 'rank', status: 'completed', retainedCandidates: 3, evaluatedCandidates: 3, usage: {inputTokens: 10}});
    expect(mock.mock.calls[0]?.[0].state).toMatchObject({objective: options.objective, pattern: options.pattern});
    expect(matches.map(match => match.line)).toEqual([1, 2, 3]);
  });

  it('retains missing and invalid judgments in original positions', async () => {
    const {jev} = setup(async () => ({modelId: 'fixture', durationMs: 1, answers: {
      'match-0': {type: 'boolean', probability: 0.1}, 'match-1': {type: 'boolean', probability: 5}, 'match-2': {type: 'boolean', probability: 0.9},
    }}));
    expect(await rankGrepMatches(matches, {...options, jev})).toMatchObject({matches: [matches[2], matches[1], matches[0]], filtering: {status: 'partial', incomplete: true, evaluatedCandidates: 2}});
  });

  it('keeps all-negative results without fabricating an empty search', async () => {
    const {jev} = setup(async input => ({modelId: 'fixture', durationMs: 1,
      answers: Object.fromEntries(Object.keys(input.questions).map(id => [id, {type: 'boolean', probability: 0}])),
    }));
    expect((await rankGrepMatches(matches, {...options, jev})).matches).toEqual(matches);
  });

  it('caps evaluated matches and retains the unevaluated tail', async () => {
    const {jev, mock} = setup(async input => ({modelId: 'fixture', durationMs: 1,
      answers: Object.fromEntries(Object.keys(input.questions).map(id => [id, {type: 'boolean', probability: 0.5}])),
    }));
    const many = Array.from({length: 50}, (_, position) => ({...matches[0], filePath: 'file', line: position + 1, column: 1, text: 'needle', textStartColumn: 1, textTruncated: false}));
    expect(await rankGrepMatches(many, {...options, jev})).toMatchObject({matches: many,
      filtering: {status: 'partial', incomplete: true, evaluatedCandidates: 32, retainedCandidates: 50}, warnings: []});
    expect(mock).toHaveBeenCalledTimes(4);
  });

  it('honors host opt-in, per-request bypass, absent objectives, and small results', async () => {
    const {jev, mock} = setup();
    expect((await rankGrepMatches(matches, options)).filtering.reason).toBe('disabled');
    expect((await rankGrepMatches(matches, {...options, jev, filter: false})).filtering.reason).toBe('disabled_for_request');
    expect((await rankGrepMatches(matches, {pattern: 'needle', jev})).filtering.reason).toBe('no_objective');
    expect((await rankGrepMatches([], {...options, jev})).filtering.reason).toBe('small_result');
    expect((await rankGrepMatches(matches, {...options, jev: {status: 'unavailable', reason: 'missing_credentials'}})).filtering.reason).toBe('missing_credentials');
    expect(mock).not.toHaveBeenCalled();
  });

  it('fails open without leaking provider errors', async () => {
    const {jev} = setup(async () => {throw new Error('PRIVATE KEY');});
    const result = await rankGrepMatches(matches, {...options, jev});
    expect(result).toMatchObject({matches, filtering: {status: 'failed', retainedCandidates: 3}});
    expect(JSON.stringify(result)).not.toContain('PRIVATE KEY');
  });

  it('enforces JEV deadlines and propagates caller cancellation', async () => {
    vi.useFakeTimers();
    const {jev} = setup(() => new Promise(() => {}));
    const pending = rankGrepMatches(matches, {...options, jev});
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({matches, filtering: {status: 'failed'}});
    const controller = new AbortController();
    const cancelled = rankGrepMatches(matches, {...options, jev, signal: controller.signal});
    controller.abort(new Error('stop'));
    await expect(cancelled).rejects.toThrow('stop');
    expect(vi.getTimerCount()).toBe(0);
  });
});
