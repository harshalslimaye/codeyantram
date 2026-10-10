import type {CoordinatedGraph, GraphIndexOptions, GraphReader} from '../contracts/graph.js';
import type {GraphCoordinatorStatus, GraphEditContext, GraphEditResult, GraphFreshness, GraphReconcileOptions} from '../contracts/coordination.js';
import {ChangeTracker} from './change-tracker.js';
import {GraphCoordinatorError} from './errors.js';
import {performGraphEdit} from './edit-session.js';
import {OperationQueue} from './operation-queue.js';
import {GraphReconciler} from './reconciler.js';
import {withGraphReader} from './query-session.js';

const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

/** Orchestrates initialization, navigation, and edits in one workspace slot. */
export class GraphCoordinator {
  readonly storage: CoordinatedGraph['storage'];
  private readonly queue = new OperationQueue();
  private readonly changes: ChangeTracker;
  private readonly reconciler: GraphReconciler;
  private readonly cleanupTimeoutMs: number;

  constructor(private readonly graph: CoordinatedGraph, options: {cleanupTimeoutMs?: number} = {}) {
    this.storage = graph.storage;
    this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    if (!Number.isInteger(this.cleanupTimeoutMs) || this.cleanupTimeoutMs < 1) {
      throw new Error('Graph cleanup timeout must be a positive integer.');
    }
    this.changes = new ChangeTracker(graph.storage.workspaceRoot);
    this.reconciler = new GraphReconciler(graph, this.changes, this.queue);
  }

  /** Diagnostic snapshots remain available during indexing and after failures. */
  getStatus(): GraphCoordinatorStatus {
    return {
      operation: this.queue.operation,
      readiness: this.reconciler.lastError ? 'error' : this.changes.dirty ? 'dirty'
        : this.reconciler.freshness ? 'ready' : 'uninitialized',
      pendingOperations: this.queue.pendingOperations, pendingPaths: this.changes.pendingPaths,
      needsFullScan: this.changes.needsFullScan,
      freshness: this.reconciler.freshness, index: this.reconciler.indexStatus,
      lastError: this.reconciler.lastError,
    };
  }

  notifyChanges(paths: readonly string[] = []): void {
    this.queue.assertOpen();
    this.changes.record(paths);
  }

  initialize(options: GraphReconcileOptions = {}) {
    return this.queue.enqueue('initializing', () => this.reconciler.run(options), options.signal);
  }

  query<T>(
    read: (graph: GraphReader, freshness: GraphFreshness) => T | Promise<T>,
    options: GraphIndexOptions = {},
  ): Promise<{value: T; freshness: GraphFreshness}> {
    return this.queue.enqueue('querying', async () => {
      const {freshness} = await this.reconciler.run(options);
      options.signal?.throwIfAborted();
      // External events can arrive after reconciliation, before the callback.
      if (this.changes.dirty) throw new GraphCoordinatorError('changes_during_sync',
        'The workspace changed after graph synchronization. Retry the query.');
      this.queue.setOperation('querying');
      const generation = this.changes.version;
      const value = await withGraphReader(this.graph, reader => read(reader, {...freshness}), options.signal);
      if (this.changes.version !== generation) throw new GraphCoordinatorError('changes_during_sync',
        'The workspace changed during the graph query. Retry the query.');
      return {value, freshness};
    }, options.signal);
  }

  edit<T>(write: (context: GraphEditContext) => T | Promise<T>, options: {signal?: AbortSignal} = {}): Promise<GraphEditResult<T>> {
    return this.queue.enqueue('editing', () => performGraphEdit(
      write, options, this.changes, this.reconciler, this.cleanupTimeoutMs,
    ), options.signal);
  }

  close(): Promise<void> {return this.queue.close(() => this.graph.close());}
}
