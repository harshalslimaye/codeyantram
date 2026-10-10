import {requireValue, asymmetric} from '../../../../shared/tests/helpers.js';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {chunkContent} from '../../../src/tools/web-fetch/chunks.js';
import {selectContent} from '../../../src/tools/web-fetch/selection.js';
import {MAX_CHUNK_CHARACTERS, MAX_CHUNKS, FILTER_TIMEOUT_MS, MAX_EVALUATED_CHUNKS} from '../../../src/tools/web-fetch/limits.js';
import type {JevEvaluator, EvaluationInput, EvaluationQuestions, EvaluationResult} from '../../../src/evaluation/index.js';
import type {JevCapability} from '../../../src/tools/web-fetch/types.js';

const sourceUrl = 'https://example.com/docs';
const section = (heading: string, text: string) => `## ${heading}\n\n${(text + ' ').repeat(140)}\n\n`;
const content = '# Manual\n\n' + section('Authentication', 'EVIDENCE use bearer tokens and rotate credentials.')
  + section('History', 'IRRELEVANT historical release announcements.') + section('Limits', 'UNCERTAIN request limits and prerequisites.');
type Evaluate = (input: EvaluationInput<EvaluationQuestions>) => Promise<EvaluationResult<EvaluationQuestions>>;
function capability(evaluate?: Evaluate) {
  const mock = vi.fn<Evaluate>(evaluate ?? (async input => {
    const state = input.state as {chunks: {id: string; text: string; sectionPath: string[]}[]};
    return {modelId: 'fixture', durationMs: 1, usage: {inputTokens: 100, outputTokens: 2},
      answers: Object.fromEntries(state.chunks.map(chunk => [chunk.id, {type: 'boolean', probability: chunk.sectionPath.includes('History') ? 0.01 : 0.8}]))};
  }));
  return {mock, jev: {status: 'available', evaluator: {evaluate: mock} as JevEvaluator} as JevCapability};
}
afterEach(() => vi.useRealTimers());

describe('lossless chunking', () => {
  it('retains stable IDs, source offsets, headings, Unicode, and fenced blocks', () => {
    const text = '# Parent\n\nIntro\n\n## Child\n\n' + '🙂'.repeat(2400) + '\n\n```ts\n# not a heading\n' + 'run();\n'.repeat(1000) + '```\n';
    const chunks = chunkContent(text, sourceUrl);
    expect(chunks.map(chunk => chunk.text).join('')).toBe(text);
    expect(chunks).toEqual(chunkContent(text, sourceUrl));
    expect(new Set(chunks.map(chunk => chunk.id)).size).toBe(chunks.length);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARACTERS);
      expect(chunk.text).toBe(text.slice(chunk.start, chunk.end));
      expect(chunk.sourceUrl).toBe(sourceUrl);
      expect(chunk.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    }
    const code = chunks.filter(chunk => chunk.codeBlock !== undefined);
    expect(new Set(code.map(chunk => chunk.codeBlock)).size).toBe(1);
    expect(requireValue(code[0]).sectionPath).toEqual(['Parent', 'Child']);
    expect(code.map(chunk => chunk.text).join('')).toContain('# not a heading');
  });
});

describe('optional relevance selection', () => {
  it('falls back without evaluation when adversarial structure creates excessive chunks', async () => {
    const {jev, mock} = capability();
    const text = '# Heading\n'.repeat(MAX_CHUNKS + 1);
    const result = await selectContent(text, sourceUrl, 'markdown', {jev, objective: 'task'});
    expect(result.content).toBe(text);
    expect(result.filtering).toMatchObject({status: 'skipped', reason: 'chunk_limit'});
    expect(mock).not.toHaveBeenCalled();
  });
  it('discards only clearly irrelevant chunks, preserves source order and heading context, and records separate usage', async () => {
    const {jev, mock} = capability();
    const selected = await selectContent(content, sourceUrl, 'markdown', {jev, objective: 'How do I authenticate?'});
    expect(selected.content).toContain('# Manual');
    expect(selected.content).toContain('EVIDENCE');
    expect(selected.content).toContain('UNCERTAIN');
    expect(selected.content).not.toContain('IRRELEVANT');
    expect(selected.content.indexOf('EVIDENCE')).toBeLessThan(selected.content.indexOf('UNCERTAIN'));
    expect(selected.filtering).toMatchObject({status: 'completed', incomplete: false, usage: {inputTokens: asymmetric.any(Number)}});
    expect(selected.filtering.retainedChunks).toBeLessThan(selected.filtering.totalChunks);
    expect((requireValue(mock.mock.calls[0])[0].state as {objective: string}).objective).toBe('How do I authenticate?');
    expect(Object.keys(requireValue(mock.mock.calls[0])[0].questions).length).toBeLessThanOrEqual(8);
  });
  it.each([
    [{status: 'disabled'}, true, 'markdown', 'task', content, 'disabled'],
    [{status: 'unavailable', reason: 'missing_credentials'}, true, 'markdown', 'task', content, 'missing_credentials'],
    [{status: 'unavailable', reason: 'initialization_failed'}, true, 'markdown', 'task', content, 'initialization_failed'],
    [null, false, 'markdown', 'task', content, 'disabled_for_request'],
    [null, true, 'html', 'task', content, 'raw_html'],
    [null, true, 'markdown', ' ', content, 'no_objective'],
    [null, true, 'markdown', 'task', 'small', 'small_document'],
  ] as const)('skips evaluation for configuration and request boundaries (case %#)', async (configuration, filter, format, objective, text, reason) => {
    const {jev, mock} = capability();
    const result = await selectContent(text, sourceUrl, format, {jev: configuration ?? jev, filter, objective});
    expect(result.content).toBe(text);
    expect(result.filtering).toMatchObject({status: 'skipped', reason});
    expect(mock).not.toHaveBeenCalled();
    if (configuration?.status === 'unavailable') expect(result.warnings).not.toHaveLength(0);
  });
  it('retains uncertainty, missing judgments, malformed answers, and complete failed batches', async () => {
    const {jev} = capability(async input => ({modelId: 'fixture', durationMs: 0, answers: Object.fromEntries(Object.keys(input.questions).map((id, i) => [id,
      i % 3 === 0 ? {type: 'boolean', probability: 0.05} : i % 3 === 1 ? {type: 'boolean', probability: NaN} : undefined,
    ]))} as EvaluationResult<EvaluationQuestions>));
    const result = await selectContent(content, sourceUrl, 'markdown', {jev, objective: 'task'});
    expect(result.content).toBe(content);
    expect(result.filtering.status).toBe('partial');
    const failed = capability(async () => {throw new Error('private credentials');});
    const fallback = await selectContent(content, sourceUrl, 'markdown', {jev: failed.jev, objective: 'task'});
    expect(fallback.content).toBe(content);
    expect(fallback.filtering).toMatchObject({status: 'failed', evaluatedChunks: 0, incomplete: true});
    expect(JSON.stringify(fallback)).not.toContain('private credentials');
  });
  it('bounds total evaluated chunks and concurrency, keeping the unevaluated tail', async () => {
    let active = 0; let peak = 0; let total = 0;
    const {jev} = capability(async input => {
      active++; peak = Math.max(peak, active); total += Object.keys(input.questions).length;
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      return {modelId: 'fixture', durationMs: 0, answers: Object.fromEntries(Object.keys(input.questions).map(id => [id, {type: 'boolean', probability: 0.01}]))};
    });
    const huge = content.repeat(8) + 'UNEVALUATED TAIL';
    const result = await selectContent(huge, sourceUrl, 'markdown', {jev, objective: 'task'});
    expect(total).toBe(MAX_EVALUATED_CHUNKS);
    expect(peak).toBe(2);
    expect(result.content).toContain('UNEVALUATED TAIL');
    expect(result.filtering).toMatchObject({status: 'partial', incomplete: true});
  });
  it('returns normal content if every chunk is rejected', async () => {
    const {jev} = capability(async input => ({modelId: 'fixture', durationMs: 0,
      answers: Object.fromEntries(Object.keys(input.questions).map(id => [id, {type: 'boolean', probability: 0}]))}));
    const result = await selectContent(content, sourceUrl, 'markdown', {jev, objective: 'task'});
    expect(result.content).toBe(content);
    expect(result.filtering.reason).toBe('no_evidence');
  });
  it('preserves a complete long code example if only its middle is judged useful', async () => {
    const code = '```ts\n' + 'const x = 1;\n'.repeat(300) + 'EVIDENCE\n' + 'run(x);\n'.repeat(500) + '```\n';
    const {jev} = capability(async input => ({modelId: 'fixture', durationMs: 0, answers: Object.fromEntries(
      (input.state as {chunks: {id: string; text: string}[]}).chunks.map(chunk => [chunk.id, {type: 'boolean', probability: chunk.text.includes('EVIDENCE') ? 0.9 : 0}]))}));
    const result = await selectContent('# Code\n\n' + code, sourceUrl, 'markdown', {jev, objective: 'task'});
    expect(result.content).toContain(code);
  });
  it('bounds non-cooperative evaluators and retains content on timeout', async () => {
    vi.useFakeTimers();
    const {jev, mock} = capability(() => new Promise(() => {}));
    const pending = selectContent(content, sourceUrl, 'markdown', {jev, objective: 'task'});
    await vi.advanceTimersByTimeAsync(FILTER_TIMEOUT_MS);
    expect((await pending).content).toBe(content);
    expect(requireValue(mock.mock.calls[0])[0].abortSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('propagates caller cancellation instead of returning a fallback result', async () => {
    const controller = new AbortController();
    const {jev, mock} = capability(() => new Promise(() => {}));
    const pending = selectContent(content, sourceUrl, 'markdown', {jev, objective: 'task', signal: controller.signal});
    controller.abort();
    await expect(pending).rejects.toMatchObject({name: 'AbortError'});
    expect(requireValue(mock.mock.calls[0])[0].abortSignal?.aborted).toBe(true);
  });
});
