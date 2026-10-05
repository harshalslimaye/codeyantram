import {vi} from 'vitest';
import {createNavigationTools, type NavigationGraphService} from '../../src/index.js';

export const reference = {workspaceId: 'a'.repeat(64), symbolId: 'function:greet', filePath: 'src/helper.ts', contentHash: 'b'.repeat(64)};
export const execution = (toolCallId = 'call-1') => ({toolCallId, messages: [], context: {}});

export function setupNavigation() {
  const reader = {find: vi.fn().mockResolvedValue({matches: []}), inspect: vi.fn().mockResolvedValue({type: 'symbol'}), trace: vi.fn().mockResolvedValue({symbols: []})};
  const freshness = {epoch: 'e', revision: 2, reconciledAt: 1};
  const query = vi.fn().mockImplementation(async callback => ({value: await callback(reader, freshness), freshness}));
  const service = {query, getStatus: vi.fn().mockReturnValue({lifecycle: 'unopened', graph: null})} as NavigationGraphService;
  return {reader, query, tools: createNavigationTools(service)};
}
