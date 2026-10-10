import type {GraphReader, GraphFreshness} from '@codeyantram/graph';
import {requireValue} from '../../../shared/tests/helpers.js';
import {describe, expect, it, vi} from 'vitest';
import {createNavigationTools, exploreInputSchema, graphInputSchema, type NavigationGraphService} from '../../src/index.js';
import {GraphSourceChangedError} from '@codeyantram/graph';
import {reference} from './helpers.js';

function setup() {
  const query = vi.fn<(callback: (reader: Pick<GraphReader, "explore">) => unknown) => Promise<{value: unknown; freshness: GraphFreshness}>>().mockResolvedValue({value: {symbols: [], matches: [], truncated: false}, freshness: {epoch: 'epoch', revision: 1, reconciledAt: 1}});
  const getStatus = vi.fn<NavigationGraphService["getStatus"]>().mockReturnValue({lifecycle: 'unopened', graph: null});
  const tools = createNavigationTools({query, getStatus} as unknown as NavigationGraphService);
  return {query, getStatus, tools};
}
const execution = (toolCallId = 'call-1') => ({toolCallId, messages: [], context: {}});

describe('bound navigation tool registry', () => {
  it('registers all five tools and shares the execution limit across focused navigation', async () => {
    const {tools, query} = setup();
    expect(Object.keys(tools)).toEqual(['explore', 'graph', 'find', 'inspect', 'trace']);
    for (let i = 0; i < 6; i++) await requireValue(tools.find.execute)({query: 'greet'}, execution(`find-${i}`));
    for (let i = 0; i < 6; i++) await requireValue(tools.inspect.execute)({reference}, execution(`inspect-${i}`));
    expect(await requireValue(tools.trace.execute)({reference, direction: 'callers'}, execution('over-limit'))).toMatchObject({status: 'error', error: {code: 'tool_limit'}});
    expect(query).toHaveBeenCalledTimes(12);
  });
  it.each([{query: ''}, {query: ' '}, {query: 'x'.repeat(1025)}, {query: 'q', maxNodes: 21},
    {query: 'q', maxCharacters: 24_001}, {query: 'q', workspaceRoot: '/other'}, {query: 'q', databasePath: '/other.db'}])
    ('rejects invalid or model-selected workspace arguments (case %#)', input => {
      expect(exploreInputSchema.safeParse(input).success).toBe(false);
    });

  it('uses the host service query barrier and returns serializable context with freshness', async () => {
    const {tools, query} = setup();
    const reader = {explore: vi.fn<GraphReader["explore"]>().mockResolvedValue({query: 'entry point', summary: '', relatedFiles: [], symbols: [], relationships: [], snippets: [], truncated: true, coverage: 'indexed scope'})};
    query.mockImplementation(async callback => ({value: await callback(reader), freshness: {epoch: 'e', revision: 2, reconciledAt: 1}}));
    const result = await requireValue(tools.explore.execute)({query: 'entry point', maxNodes: 5}, execution());
    expect(reader.explore).toHaveBeenCalledExactlyOnceWith('entry point', {query: 'entry point', maxNodes: 5});
    expect(result).toMatchObject({toolCallId: 'call-1', toolName: 'explore', status: 'success', output: {context: {truncated: true}, freshness: {revision: 2}}});
  });

  it('reports diagnostics without acquiring or scanning a graph and never exposes storage paths', async () => {
    const {tools, query, getStatus} = setup();
    expect(graphInputSchema.safeParse({root: '/other'}).success).toBe(false);
    expect(await requireValue(tools.graph.execute)({}, execution())).toMatchObject({status: 'success', output: {lifecycle: 'unopened', watcher: 'disabled', graph: null}});
    expect(query).not.toHaveBeenCalled();
    expect(getStatus).toHaveBeenCalledOnce();
  });

  it('returns structured failures and allows graph diagnostics after an explore failure', async () => {
    const {tools, query} = setup();
    query.mockRejectedValueOnce(new GraphSourceChangedError());
    expect(await requireValue(tools.explore.execute)({query: 'q'}, execution())).toMatchObject({status: 'error', error: {code: 'graph_stale'}});
    query.mockRejectedValueOnce(new Error('private SQLite path and credentials'));
    const failure = await requireValue(tools.explore.execute)({query: 'q'}, execution('call-2'));
    expect(failure).toMatchObject({status: 'error', error: {code: 'graph_unavailable'}});
    expect(JSON.stringify(failure)).not.toContain('private SQLite');
    expect(await requireValue(tools.graph.execute)({}, execution('call-3'))).toMatchObject({status: 'success'});
  });

  it('limits calls per turn and stops cancelled calls before graph work', async () => {
    const {tools, query} = setup();
    expect(await requireValue(tools.explore.execute)({query: 'q'}, {...execution(), abortSignal: AbortSignal.abort()})).toMatchObject({status: 'error', error: {code: 'cancelled'}});
    expect(query).not.toHaveBeenCalled();
    for (let i = 1; i < 12; i++) await requireValue(tools.graph.execute)({}, execution(`call-${i}`));
    expect(await requireValue(tools.graph.execute)({}, execution('limit'))).toMatchObject({status: 'error', error: {code: 'tool_limit'}});
  });
});
