import {GraphSourceChangedError, GraphCoordinatorError} from '@codeyantram/graph';
import {toolResultSchema, type ToolResult} from '@codeyantram/shared';
import type {NavigationExecutor} from './types.js';

/** Create once per turn so all navigation tools share the same call budget. */
export function createNavigationExecutor(): NavigationExecutor {
  let executions = 0;
  return async (name, id, signal, run) => {
    const error = (code: Extract<ToolResult, {status: 'error'}>['error']['code'], message: string): ToolResult =>
      ({toolCallId: id, toolName: name, status: 'error', error: {code, message}});
    if (++executions > 12) return error('tool_limit', 'The navigation call limit was reached. Narrow the task or continue in another turn.');
    try {
      signal?.throwIfAborted();
      const output = await run();
      signal?.throwIfAborted();
      const result = toolResultSchema.parse({toolCallId: id, toolName: name, status: 'success', output});
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 80_000) return error('execution_failed', 'Navigation output exceeded the host limit. Request less context.');
      return result;
    } catch (failure) {
      if (signal?.aborted) return error('cancelled', 'Navigation cancelled.');
      if (failure instanceof GraphSourceChangedError) return error('graph_stale', failure.message);
      if (failure instanceof GraphCoordinatorError && failure.code === 'changes_during_sync') return error('graph_stale', 'The workspace changed during navigation. Retry explore.');
      return error('graph_unavailable', 'Graph navigation could not establish current context. Use graph for diagnostics or /init to retry.');
    }
  };
}
