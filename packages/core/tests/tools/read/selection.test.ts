import {afterEach, describe, expect, it, vi} from 'vitest';
import {selectReadChunks} from '../../../src/tools/read/selection.js';
import type {ReadChunk} from '../../../src/tools/read/chunks.js';
import {chunkLines} from '../../../src/tools/read/chunks.js';
import type {EvaluationInput, EvaluationQuestions, EvaluationResult, JevEvaluator, JevCapability} from '../../../src/index.js';

type Evaluate = (input: EvaluationInput<EvaluationQuestions>) => Promise<EvaluationResult<EvaluationQuestions>>;
const chunks: ReadChunk[] = Array.from({length: 5}, (_, position) => ({id: `range-${position}`,
  startLine: position * 40 + 1, endLine: (position + 1) * 40, text: (`range ${position} source\n`).repeat(150),
}));
function setup(evaluate?: Evaluate) {
  const mock = vi.fn<Evaluate>(evaluate ?? (async input => ({modelId: 'fixture', durationMs: 1, usage: {inputTokens: 10, outputTokens: 2},
    answers: Object.fromEntries(Object.keys(input.questions).map(id => [id, {type: 'boolean', probability: id === 'range-4' ? 0.9 : 0.01}])),
  })));
  const jev: JevCapability = {status: 'available', evaluator: {evaluate: mock} as JevEvaluator};
  return {mock, jev};
}
const options = {filePath: 'src/file.ts', objective: 'Find relevant implementation'};
afterEach(() => vi.useRealTimers());

describe('read relevance selection', () => {
  it.each([[undefined, true], [0.5, true], [0.6, true], [0.8, false]] as const)('uses neighbor threshold %s', async (neighborThreshold, keptNeighbor) => {
    const {jev} = setup(async input => ({modelId: 'fixture', durationMs: 0,
      answers: Object.fromEntries(Object.keys(input.questions).map(id => [id, {type: 'boolean', probability: id === 'range-2' ? 0.6 : 0.01}])),
    }));
    if (jev.status !== 'available') throw new Error('Expected available evaluator');
    const result = await selectReadChunks(chunks, {...options, jev: {...jev, neighborThreshold}});
    expect(result.chunks.some(chunk => chunk.id === 'range-1')).toBe(keptNeighbor);
    expect(result.chunks.some(chunk => chunk.id === 'range-2')).toBe(true);
  });
  it.each([[undefined, false], [0.1, true], [0.15, true], [0.2, false]] as const)('uses retention threshold %s', async (retentionThreshold, kept) => {
    const {jev} = setup(async input => ({modelId: 'fixture', durationMs: 0,
      answers: Object.fromEntries(Object.keys(input.questions).map(id => [id, {type: 'boolean', probability: id === 'range-1' ? 0.15 : id === 'range-4' ? 0.9 : 0.01}])),
    }));
    if (jev.status !== 'available') throw new Error('Expected available evaluator');
    const result = await selectReadChunks(chunks, {...options, jev: {...jev, retentionThreshold}});
    expect(result.chunks.some(chunk => chunk.id === 'range-1')).toBe(kept);
  });
  it('retains whole ranges, leading context, neighboring evidence, and original locations', async () => {
    const {jev, mock} = setup();
    const result = await selectReadChunks(chunks, {...options, jev});
    expect(result.chunks).toEqual([chunks[0], chunks[3], chunks[4]]);
    expect(result.filtering).toMatchObject({status: 'completed', totalChunks: 5, evaluatedChunks: 5, retainedChunks: 3, usage: {inputTokens: 10}});
    expect(mock.mock.calls[0]?.[0].state).toMatchObject({objective: options.objective, filePath: options.filePath});
    expect(result.warnings.join(' ')).toContain('request focused line ranges');
  });

  it('returns the original page when all judgments are negative', async () => {
    const {jev} = setup(async input => ({modelId: 'fixture', durationMs: 1,
      answers: Object.fromEntries(Object.keys(input.questions).map(id => [id, {type: 'boolean', probability: 0}])),
    }));
    expect(await selectReadChunks(chunks, {...options, jev})).toMatchObject({chunks, filtering: {reason: 'no_evidence', retainedChunks: 5}});
  });

  it('retains missing or invalid judgments and reports partial evaluation', async () => {
    const {jev} = setup(async () => ({modelId: 'fixture', durationMs: 1, answers: {'range-1': {type: 'boolean', probability: 0}, 'range-2': {type: 'boolean', probability: 5}}}));
    const result = await selectReadChunks(chunks, {...options, jev});
    expect(result.chunks).toEqual([chunks[0], chunks[2], chunks[3], chunks[4]]);
    expect(result.filtering).toMatchObject({status: 'partial', incomplete: true, evaluatedChunks: 1});
  });

  it('fails open without leaking provider errors', async () => {
    const {jev} = setup(async () => {throw new Error('PRIVATE API KEY');});
    const result = await selectReadChunks(chunks, {...options, jev});
    expect(result).toMatchObject({chunks, filtering: {status: 'failed', evaluatedChunks: 0}});
    expect(JSON.stringify(result)).not.toContain('PRIVATE API KEY');
  });

  it('skips disabled, unavailable, small, and objective-free reads', async () => {
    const {jev, mock} = setup();
    expect((await selectReadChunks(chunks, options)).filtering.reason).toBe('disabled');
    expect((await selectReadChunks(chunks, {...options, jev: {status: 'unavailable', reason: 'missing_credentials'}})).filtering.reason).toBe('missing_credentials');
    expect((await selectReadChunks([], {...options, jev})).filtering.reason).toBe('small_content');
    expect((await selectReadChunks(chunks, {filePath: 'file', jev})).filtering.reason).toBe('no_objective');
    expect(mock).not.toHaveBeenCalled();
  });

  it('caps evaluation and retains the unevaluated tail', async () => {
    const {jev, mock} = setup();
    const many = Array.from({length: 40}, (_, position) => ({id: `chunk-${position}`, startLine: position + 1, endLine: position + 1, text: 'code '.repeat(50)}));
    const result = await selectReadChunks(many, {...options, jev});
    expect(mock).toHaveBeenCalledTimes(4);
    expect(result.filtering).toMatchObject({status: 'partial', evaluatedChunks: 32, incomplete: true});
    expect(result.chunks.slice(-8)).toEqual(many.slice(-8));
  });

  it('enforces the evaluation deadline and propagates caller cancellation', async () => {
    vi.useFakeTimers();
    const {jev} = setup(() => new Promise(() => {}));
    const timed = selectReadChunks(chunks, {...options, jev});
    await vi.advanceTimersByTimeAsync(5000);
    expect(await timed).toMatchObject({chunks, filtering: {status: 'failed'}});
    const controller = new AbortController();
    const cancelled = selectReadChunks(chunks, {...options, jev, signal: controller.signal});
    controller.abort(new Error('stop'));
    await expect(cancelled).rejects.toThrow('stop');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('chunks only at whole line boundaries', () => {
    const lines = Array.from({length: 100}, (_, position) => ({number: position + 10, text: 'x'.repeat(100), truncated: false}));
    const result = chunkLines(lines);
    expect(result[0]?.startLine).toBe(10);
    expect(result.at(-1)?.endLine).toBe(109);
    expect(result.map(chunk => chunk.text).join('\n')).toBe(lines.map(line => line.text).join('\n'));
  });
});
