import {afterEach, describe, expect, it, vi} from 'vitest';
import type {GraphExploreContext, GraphFindResult, GraphNavigationSymbol} from '@codeyantram/graph';
import {requireValue, parseJson} from '../../../shared/tests/helpers.js';
import {createNavigationTools, type NavigationGraphService, type JevEvaluator, type EvaluationInput, type EvaluationQuestions, type EvaluationResult, type NavigationEvaluationOptions} from '../../src/index.js';
import {execution, reference} from './helpers.js';

type Evaluate = (input: EvaluationInput<EvaluationQuestions>) => Promise<EvaluationResult<EvaluationQuestions>>;
const symbol = (id: string): GraphNavigationSymbol => ({
  id, name: id, qualifiedName: id, kind: 'function', language: 'typescript', filePath: `src/${id}.ts`,
  startLine: 1, endLine: 3, metadataTruncated: false, reference: {...reference, symbolId: id, filePath: `src/${id}.ts`},
});
const symbols = ['target', 'dependency', 'irrelevant'].map(symbol);
function exploreContext(): GraphExploreContext {
  return {query: 'task', summary: 'Original graph summary', symbols,
    snippets: symbols.map(current => ({symbolId: current.id, filePath: current.filePath, startLine: 1, endLine: 3,
      contentHash: reference.contentHash, text: `function ${current.id}() {}`, truncated: false})),
    relationships: [{source: 'target', target: 'dependency', kind: 'calls', metadata: {line: 2}}],
    relatedFiles: symbols.map(current => current.filePath), truncated: true, coverage: 'indexed scope',
  };
}
function findContext(): GraphFindResult {
  return {query: 'task', matches: symbols.map((current, position) => ({symbol: current, score: 10 - position})), truncated: true, coverage: 'indexed scope'};
}
function setup(context: GraphExploreContext | GraphFindResult, evaluate?: Evaluate, options: NavigationEvaluationOptions = {}) {
  const query = vi.fn<NavigationGraphService['query']>().mockResolvedValue({value: context, freshness: {epoch: 'e', revision: 2, reconciledAt: 1}});
  const mock = vi.fn<Evaluate>(evaluate ?? (async input => ({modelId: 'fixture', durationMs: 1,
    answers: Object.fromEntries(Object.keys(input.questions).map(id => [id, {type: 'boolean', probability: id === 'target' ? 0.9 : 0.01}])),
    usage: {inputTokens: 10, outputTokens: 2},
  })));
  const service = {query, getStatus: () => ({lifecycle: 'ready', graph: null})} as unknown as NavigationGraphService;
  const tools = createNavigationTools(service, undefined,
    {jev: {status: 'available', evaluator: {evaluate: mock} as JevEvaluator}, ...options});
  return {tools, query, mock};
}
function toolExecute(tools: ReturnType<typeof createNavigationTools>, name: 'explore' | 'find') {
  return requireValue(name === 'explore' ? tools.explore.execute : tools.find.execute);
}
afterEach(() => vi.useRealTimers());

describe('JEV explore selection', () => {
  it('filters whole symbols and snippets but retains connected dependencies and provenance', async () => {
    const original = exploreContext();
    const {tools, mock} = setup(original, undefined, {objective: 'User objective'});
    const result = await requireValue(tools.explore.execute)({query: 'task'}, execution());
    expect(result).toMatchObject({status: 'success', output: {
      context: {symbols: [symbols[0], symbols[1]], relationships: original.relationships,
        snippets: original.snippets.slice(0, 2), relatedFiles: ['src/target.ts', 'src/dependency.ts'],
        summary: '', coverage: original.coverage, truncated: true},
      freshness: {revision: 2}, filtering: {mode: 'filter', status: 'completed', totalCandidates: 3, evaluatedCandidates: 3,
        retainedCandidates: 2, usage: {inputTokens: 10, outputTokens: 2}},
    }});
    const input = requireValue(mock.mock.calls[0])[0];
    if (typeof input.state !== 'string') throw new Error('Expected serialized graph evidence.');
    expect(parseJson<{objective: string; query: string; snippets: unknown[]}>(input.state)).toMatchObject({objective: 'User objective', query: 'task', snippets: original.snippets});
    expect(original.symbols).toHaveLength(3);
    expect(original.summary).toBe('Original graph summary');
  });

  it('retains transitive relationships even when edges are in reverse traversal order', async () => {
    const context = exploreContext();
    context.relationships = [{source: 'dependency', target: 'irrelevant', kind: 'calls'}, ...context.relationships];
    const {tools} = setup(context);
    expect(await requireValue(tools.explore.execute)({query: 'task'}, execution())).toMatchObject({status: 'success', output: {context, filtering: {retainedCandidates: 3}}});
  });

  it('falls back when every symbol is judged irrelevant', async () => {
    const context = exploreContext();
    const {tools} = setup(context, async input => ({modelId: 'fixture', durationMs: 1,
      answers: Object.fromEntries(Object.keys(input.questions).map(id => [id, {type: 'boolean', probability: 0}])),
    }));
    expect(await requireValue(tools.explore.execute)({query: 'task'}, execution())).toMatchObject({status: 'success', output: {context, filtering: {reason: 'no_evidence', retainedCandidates: 3}}});
  });

  it('retains missing judgments and reports partial evaluation', async () => {
    const context = exploreContext();
    const {tools} = setup(context, async () => ({modelId: 'fixture', durationMs: 1, answers: {target: {type: 'boolean', probability: 0.9}}}));
    expect(await requireValue(tools.explore.execute)({query: 'task'}, execution())).toMatchObject({status: 'success', output: {context, filtering: {status: 'partial', incomplete: true, evaluatedCandidates: 1, retainedCandidates: 3}}});
  });
});

describe('JEV find ranking', () => {
  it('ranks evaluated candidates without losing references or changing retrieval scores', async () => {
    const context = findContext();
    const {tools} = setup(context, async () => ({modelId: 'fixture', durationMs: 1, answers: {
      target: {type: 'boolean', probability: 0.1}, dependency: {type: 'boolean', probability: 0.9}, irrelevant: {type: 'boolean', probability: 0.01},
    }}));
    expect(await requireValue(tools.find.execute)({query: 'task'}, execution())).toMatchObject({status: 'success', output: {
      context: {...context, matches: [context.matches[1], context.matches[0], context.matches[2]]},
      filtering: {mode: 'rank', retainedCandidates: 3, status: 'completed'}, freshness: {revision: 2},
    }});
    expect(context.matches.map(match => match.symbol.id)).toEqual(['target', 'dependency', 'irrelevant']);
  });

  it('keeps unknown candidates in their original positions', async () => {
    const context = findContext();
    const {tools} = setup(context, async () => ({modelId: 'fixture', durationMs: 1, answers: {
      target: {type: 'boolean', probability: 0.1}, irrelevant: {type: 'boolean', probability: 0.9},
    }}));
    expect(await requireValue(tools.find.execute)({query: 'task'}, execution())).toMatchObject({status: 'success', output: {
      context: {matches: [context.matches[2], context.matches[1], context.matches[0]]}, filtering: {status: 'partial'},
    }});
  });

  it('caps evaluation at 32 candidates and retains the unevaluated tail', async () => {
    const context = findContext();
    context.matches = Array.from({length: 50}, (_, position) => ({symbol: symbol(`symbol-${position}`), score: 50 - position}));
    const {tools, mock} = setup(context);
    expect(await requireValue(tools.find.execute)({query: 'task'}, execution())).toMatchObject({status: 'success', output: {
      context, filtering: {status: 'partial', totalCandidates: 50, evaluatedCandidates: 32, retainedCandidates: 50}, warnings: [],
    }});
    expect(mock).toHaveBeenCalledTimes(4);
  });
});

describe.each(['explore', 'find'] as const)('%s JEV controls', tool => {
  const context = () => tool === 'explore' ? exploreContext() : findContext();
  it('skips evaluation for small results', async () => {
    const original = context();
    if ('symbols' in original) {
      original.symbols = [];
      original.relationships = [];
      original.snippets = [];
    } else original.matches = [];
    const {tools, mock} = setup(original);
    expect(await toolExecute(tools, tool)({query: 'task'}, execution())).toMatchObject({status: 'success', output: {context: original, filtering: {status: 'skipped', reason: 'small_result'}}});
    expect(mock).not.toHaveBeenCalled();
  });
  it.each(['disabled', 'missing_credentials', 'initialization_failed'] as const)('respects host capability: %s', async reason => {
      const original = context();
      const jev = reason === 'disabled' ? {status: 'disabled' as const} : {status: 'unavailable' as const, reason};
      const {tools, mock} = setup(original, undefined, {jev});
      expect(await toolExecute(tools, tool)({query: 'task'}, execution())).toMatchObject({status: 'success', output: {context: original, filtering: {status: 'skipped', reason}}});
      expect(mock).not.toHaveBeenCalled();
  });

  it('supports per-request opt-out', async () => {
    const original = context();
    const {tools, mock} = setup(original);
    expect(await toolExecute(tools, tool)({query: 'task', filter: false}, execution())).toMatchObject({status: 'success', output: {context: original, filtering: {reason: 'disabled_for_request'}}});
    expect(mock).not.toHaveBeenCalled();
  });

  it('returns unmodified results on provider failure without exposing errors', async () => {
    const original = context();
    const {tools} = setup(original, async () => {throw new Error('private credential');});
    const result = await toolExecute(tools, tool)({query: 'task'}, execution());
    expect(result).toMatchObject({status: 'success', output: {context: original, filtering: {status: 'failed'}}});
    expect(JSON.stringify(result)).not.toContain('private credential');
  });

  it('bounds evaluation latency', async () => {
    vi.useFakeTimers();
    const original = context();
    const {tools} = setup(original, () => new Promise(() => {}));
    const pending = toolExecute(tools, tool)({query: 'task'}, execution());
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({status: 'success', output: {context: original, filtering: {status: 'failed'}}});
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates caller cancellation instead of falling back', async () => {
    let started!: () => void;
    const entered = new Promise<void>(resolve => {started = resolve;});
    const {tools} = setup(context(), () => {started(); return new Promise(() => {});});
    const controller = new AbortController();
    const pending = toolExecute(tools, tool)({query: 'task'}, {...execution(), abortSignal: controller.signal});
    await entered;
    controller.abort();
    expect(await pending).toMatchObject({status: 'error', error: {code: 'cancelled'}});
  });
});
