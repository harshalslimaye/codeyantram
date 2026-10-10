import type {GraphReader, GraphFreshness} from '@codeyantram/graph';
import {vi} from 'vitest';
import {createNavigationTools, type NavigationGraphService} from '../../src/index.js';

export const reference = {workspaceId: 'a'.repeat(64), symbolId: 'function:greet', filePath: 'src/helper.ts', contentHash: 'b'.repeat(64)};
export const execution = (toolCallId = 'call-1') => ({toolCallId, messages: [], context: {}});

export function setupNavigation() {
  const reader = {find: vi.fn<(...args: Parameters<GraphReader["find"]>) => Promise<{matches: unknown[]}>>().mockResolvedValue({matches: []}), inspect: vi.fn<(...args: Parameters<GraphReader["inspect"]>) => Promise<{type: string}>>().mockResolvedValue({type: 'symbol'}), trace: vi.fn<(...args: Parameters<GraphReader["trace"]>) => Promise<{symbols: unknown[]}>>().mockResolvedValue({symbols: []})};
  const freshness = {epoch: 'e', revision: 2, reconciledAt: 1};
  const query = vi.fn<(callback: (current: typeof reader, freshness: GraphFreshness) => unknown) => Promise<{value: unknown; freshness: GraphFreshness}>>().mockImplementation(async callback => ({value: await callback(reader, freshness), freshness}));
  const service = {query, getStatus: vi.fn<NavigationGraphService["getStatus"]>().mockReturnValue({lifecycle: 'unopened', graph: null})} as unknown as NavigationGraphService;
  return {reader, query, tools: createNavigationTools(service)};
}
