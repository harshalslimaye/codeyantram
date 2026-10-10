import {GraphSourceChangedError, GraphCoordinatorError, GraphNavigationError} from '@codeyantram/graph';
import type {ToolResult} from '@codeyantram/shared';

export function mapGraphError(failure: unknown): Extract<ToolResult, {status: 'error'}>['error'] {
  if (failure instanceof GraphNavigationError) return {code: failure.code, message: failure.message};
  if (failure instanceof GraphSourceChangedError) return {code: 'graph_stale', message: failure.message};
  if (failure instanceof GraphCoordinatorError && failure.code === 'changes_during_sync') {
    return {code: 'graph_stale', message: 'The workspace changed during navigation. Retry explore.'};
  }
  return {code: 'graph_unavailable', message: 'Graph navigation could not establish current context. Use graph for diagnostics or /init to retry.'};
}
