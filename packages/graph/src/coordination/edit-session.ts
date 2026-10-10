import type {GraphEditContext, GraphEditResult} from '../contracts/coordination.js';
import type {ChangeJournal, ReconcileWorkspace} from './ports.js';
import {GraphCoordinatorError} from './errors.js';

/** Captures partial writes and reconciles them with an independent cleanup deadline. */
export async function performGraphEdit<T>(
  write: (context: GraphEditContext) => T | Promise<T>,
  options: {signal?: AbortSignal; cleanupTimeoutMs: number},
  changes: ChangeJournal,
  reconciler: ReconcileWorkspace,
): Promise<GraphEditResult<T>> {
  const changed = new Set<string>();
  let active = true;
  let mutation: GraphEditResult<T>['mutation'];
  try {
    const value = await write({signal: options.signal, markChanged: (...paths) => {
      if (!active) throw new Error('Changed paths must be recorded inside the edit callback.');
      if (!paths.length) throw new Error('Record at least one changed file path.');
      for (const file of changes.record(paths)) changed.add(file);
    }});
    mutation = {success: true, value, changedPaths: [...changed].sort()};
  } catch (error) {
    mutation = {success: false, error, changedPaths: [...changed].sort()};
  } finally {active = false;}
  if (!changed.size) return {mutation, graph: {state: 'unchanged'}};
  // Cleanup belongs to the workspace, not the cancelled chat. Abort on a
  // deadline but keep the slot until the SDK settles; never race/close it.
  const cleanup = new AbortController();
  const timeout = new GraphCoordinatorError('cleanup_timeout', 'Graph synchronization after the edit timed out. Retry synchronization; do not replay the edit.');
  const timer = setTimeout(() => cleanup.abort(timeout), options.cleanupTimeoutMs);
  timer.unref();
  try {
    const {freshness} = await reconciler.run({signal: cleanup.signal});
    return {mutation, graph: {state: 'synchronized', freshness}};
  } catch (error) {
    let failure: GraphCoordinatorError;
    if (cleanup.signal.aborted) failure = timeout;
    else if (error instanceof GraphCoordinatorError) failure = error;
    else failure = new GraphCoordinatorError('sync_failed', 'Graph synchronization after the edit failed.', undefined, {cause: error});
    reconciler.recordFailure(failure);
    return {mutation, graph: {state: 'failed', error: failure}};
  } finally {clearTimeout(timer);}
}
