import {tool} from 'ai';
import {z} from 'zod';
import type {NavigationExecutor, NavigationGraphService} from './types.js';

export const graphInputSchema = z.strictObject({});

export function createGraphTool(service: NavigationGraphService, execute: NavigationExecutor) {
  return tool({
    description: 'Read graph lifecycle, freshness, pending changes, and last failure without opening or indexing it. Diagnostic status remains available when navigation fails.',
    inputSchema: graphInputSchema,
    execute: (_input, options) => execute('graph', options.toolCallId, options.abortSignal, async () => {
      const status = service.getStatus();
      const graph = status.graph;
      return {lifecycle: status.lifecycle, watcher: 'disabled', reconciliation: 'before-every-query',
        graph: graph && {...graph, pendingPaths: graph.pendingPaths.slice(0, 20),
          pendingPathsTruncated: graph.pendingPaths.length > 20,
          lastError: graph.lastError ? {code: graph.lastError.code, message: 'Graph reconciliation failed. Run /init to retry.'} : null}};
    }),
  });
}
