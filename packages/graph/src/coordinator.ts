import {randomUUID} from 'node:crypto';
import path from 'node:path';
import type {
  WorkspaceGraph, GraphIndexOptions, GraphIndexReport, GraphSyncReport, GraphStatus,
} from './adapter.js';

export type GraphReader = Pick<WorkspaceGraph,
  'search' | 'getSymbol' | 'getSource' | 'getCallers' | 'getCallees'>;
export type CoordinatedGraph = GraphReader & Pick<WorkspaceGraph,
  'storage' | 'getStatus' | 'index' | 'sync' | 'close'>;

export interface GraphFreshness {
  /** These identify this coordinator's observations, not a database transaction. */
  epoch: string;
  revision: number;
  reconciledAt: number;
}

export interface GraphInitialization {
  status: GraphStatus;
  freshness: GraphFreshness;
  index?: GraphIndexReport;
  sync?: GraphSyncReport;
}

export interface GraphReconcileOptions extends GraphIndexOptions {
  onOperation?: (operation: 'index' | 'sync') => void;
}

export class GraphCoordinatorError extends Error {
  constructor(
    readonly code: 'index_failed' | 'sync_failed' | 'changes_during_sync' | 'cleanup_timeout' | 'closed',
    message: string,
    readonly report?: GraphIndexReport | GraphSyncReport,
    options?: ErrorOptions,
  ) {super(message, options); this.name = 'GraphCoordinatorError';}
}

export interface GraphCoordinatorStatus {
  operation: 'idle' | 'initializing' | 'synchronizing' | 'querying' | 'editing' | 'closing' | 'closed';
  readiness: 'uninitialized' | 'ready' | 'dirty' | 'error';
  pendingOperations: number;
  pendingPaths: string[];
  needsFullScan: boolean;
  freshness: GraphFreshness | null;
  index: GraphStatus | null;
  lastError: GraphCoordinatorError | null;
}

export interface GraphEditContext {
  signal?: AbortSignal;
  /** Record immediately after a write, or before a write that could partially fail.
   * Paths are conservative: a failed write may have left these files unchanged.
   * File authorization and the actual writes remain the caller's responsibility. */
  markChanged(...paths: string[]): void;
}

export interface GraphEditResult<T> {
  mutation: {success: true; value: T; changedPaths: string[]}
    | {success: false; error: unknown; changedPaths: string[]};
  graph: {state: 'unchanged'} | {state: 'synchronized'; freshness: GraphFreshness}
    | {state: 'failed'; error: GraphCoordinatorError};
}

/** All initialization, mutation, sync, and navigation share one workspace slot. */
export class GraphCoordinator {
  readonly storage: CoordinatedGraph['storage'];
  private readonly epoch = randomUUID();
  private revision = 0;
  private generation = 0;
  private readonly changes = new Map<string, number>();
  private unknownChange = 0;
  private tail: Promise<void> = Promise.resolve();
  private closing?: Promise<void>;
  private operation: GraphCoordinatorStatus['operation'] = 'idle';
  private pendingOperations = 0;
  private freshness: GraphFreshness | null = null;
  private indexStatus: GraphStatus | null = null;
  private lastError: GraphCoordinatorError | null = null;
  private readonly cleanupTimeoutMs: number;

  constructor(private readonly graph: CoordinatedGraph, options: {cleanupTimeoutMs?: number} = {}) {
    this.storage = graph.storage;
    this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? 30_000;
    if (!Number.isInteger(this.cleanupTimeoutMs) || this.cleanupTimeoutMs < 1) {
      throw new Error('Graph cleanup timeout must be a positive integer.');
    }
  }

  /** Diagnostic snapshot remains available during indexing and after failures. */
  getStatus(): GraphCoordinatorStatus {
    return {
      operation: this.operation,
      readiness: this.lastError ? 'error' : this.changes.size || this.unknownChange ? 'dirty'
        : this.freshness ? 'ready' : 'uninitialized',
      pendingOperations: this.pendingOperations, pendingPaths: [...this.changes.keys()].sort(),
      needsFullScan: Boolean(this.unknownChange),
      freshness: this.freshness && {...this.freshness}, index: this.indexStatus && {...this.indexStatus},
      lastError: this.lastError,
    };
  }

  /** Optional external-change notifications; queries scan even without a watcher. */
  notifyChanges(paths: readonly string[] = []): void {
    if (this.closing) throw this.closedError();
    this.recordChanges(paths);
  }

  private recordChanges(paths: readonly string[]): string[] {
    const relative = paths.map(file => {
      if (!file.trim()) throw new Error('A changed file path is required.');
      const resolved = path.resolve(this.storage.workspaceRoot, file);
      const name = path.relative(this.storage.workspaceRoot, resolved);
      if (!name || name === '..' || name.startsWith(`..${path.sep}`) || path.isAbsolute(name)) {
        throw new Error('Changed files must be inside the graph workspace.');
      }
      return name.split(path.sep).join('/');
    });
    const generation = ++this.generation;
    if (!relative.length) this.unknownChange = generation;
    for (const file of relative) this.changes.set(file, generation);
    return relative;
  }

  private closedError() {
    return new GraphCoordinatorError('closed', 'The graph coordinator is closing or closed.');
  }

  private enqueue<T>(operation: GraphCoordinatorStatus['operation'], run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.closing) return Promise.reject(this.closedError());
    this.pendingOperations++;
    const result = this.tail.then(async () => {
      try {
        signal?.throwIfAborted();
        if (!this.closing) this.operation = operation;
        return await run();
      } finally {
        this.pendingOperations--;
        if (!this.closing) this.operation = 'idle';
      }
    });
    this.tail = result.then(() => {}, () => {});
    return result;
  }

  initialize(options: GraphReconcileOptions = {}): Promise<GraphInitialization> {
    return this.enqueue('initializing', () => this.reconcile(options), options.signal);
  }

  private async reconcile(options: GraphReconcileOptions): Promise<GraphInitialization> {
    let index: GraphIndexReport | undefined;
    let sync: GraphSyncReport | undefined;
    try {
      // A newer notification is never cleared by an older pass. Bound retries
      // so a continuously changing workspace cannot starve the queue forever.
      for (let pass = 0; pass < 3; pass++) {
        options.signal?.throwIfAborted();
        const generation = this.generation;
        const status = this.graph.getStatus();
        if (status.indexState !== 'complete' || status.needsReindex) {
          if (!this.closing) this.operation = 'initializing';
          options.onOperation?.('index');
          index = await this.graph.index(options);
          options.signal?.throwIfAborted();
          if (!index.success) throw new GraphCoordinatorError('index_failed',
            `Graph indexing did not complete (state: ${index.state ?? 'uninitialized'}, ${index.filesErrored} failed files). Run init again to retry.`, index);
        } else {
          if (!this.closing) this.operation = 'synchronizing';
          options.onOperation?.('sync');
          sync = await this.graph.sync(options);
          options.signal?.throwIfAborted();
          if (!sync.success) throw new GraphCoordinatorError('sync_failed',
            `Graph sync did not complete (${sync.failedFilePaths.length} failed files). Run init again to retry.`, sync);
        }
        this.indexStatus = this.graph.getStatus();
        if (this.indexStatus.indexState !== 'complete' || this.indexStatus.needsReindex) {
          throw new GraphCoordinatorError('sync_failed', 'The graph has no current, complete baseline. Run init again to retry.');
        }
        // Conservative local observation revision: even a no-op sync could
        // have observed another process's writes. Do not treat it as a DB version.
        this.freshness = {epoch: this.epoch, revision: ++this.revision, reconciledAt: Date.now()};
        for (const [file, version] of this.changes) if (version <= generation) this.changes.delete(file);
        if (this.unknownChange <= generation) this.unknownChange = 0;
        if (this.changes.size || this.unknownChange) continue;
        this.lastError = null;
        return {status: {...this.indexStatus}, freshness: {...this.freshness}, index, sync};
      }
      throw new GraphCoordinatorError('changes_during_sync', 'The workspace kept changing during graph synchronization. Retry the query.');
    } catch (error) {
      // Failed/cancelled sync can have written part of the index. Preserve dirty
      // state and require another reconciliation before any navigation.
      this.unknownChange = ++this.generation;
      this.lastError = error instanceof GraphCoordinatorError ? error
        : new GraphCoordinatorError('sync_failed', error instanceof Error ? error.message : 'Graph synchronization failed.', undefined, {cause: error});
      throw options.signal?.aborted ? error : this.lastError;
    }
  }

  query<T>(read: (graph: GraphReader, freshness: GraphFreshness) => T | Promise<T>, options: GraphIndexOptions = {}): Promise<{value: T; freshness: GraphFreshness}> {
    return this.enqueue('querying', async () => {
      const {freshness} = await this.reconcile(options);
      options.signal?.throwIfAborted();
      // An external event can run in the microtask gap after reconciliation.
      // The queue excludes agent edits, but it cannot exclude editor events.
      if (this.changes.size || this.unknownChange) throw new GraphCoordinatorError('changes_during_sync',
        'The workspace changed after graph synchronization. Retry the query.');
      if (!this.closing) this.operation = 'querying';
      let active = true;
      const pending: Promise<unknown>[] = [];
      const check = () => {
        if (!active) throw new Error('Graph readers can only be used inside their query callback.');
        options.signal?.throwIfAborted();
      };
      const reader: GraphReader = {
        search: (...args) => {check(); return this.graph.search(...args);},
        getSymbol: (...args) => {check(); return this.graph.getSymbol(...args);},
        getCallers: (...args) => {check(); return this.graph.getCallers(...args);},
        getCallees: (...args) => {check(); return this.graph.getCallees(...args);},
        getSource: (...args) => {
          check(); const result = this.graph.getSource(...args); pending.push(result);
          // Also observe fire-and-forget failures until the callback drains.
          void result.catch(() => {}); return result;
        },
      };
      const generation = this.generation;
      try {
        const value = await read(reader, {...freshness});
        active = false;
        await Promise.all(pending);
        options.signal?.throwIfAborted();
        if (this.generation !== generation) throw new GraphCoordinatorError('changes_during_sync',
          'The workspace changed during the graph query. Retry the query.');
        return {value, freshness};
      } finally {
        active = false;
        await Promise.allSettled(pending);
      }
    }, options.signal);
  }

  edit<T>(write: (context: GraphEditContext) => T | Promise<T>, options: {signal?: AbortSignal} = {}): Promise<GraphEditResult<T>> {
    return this.enqueue('editing', async () => {
      const changed = new Set<string>();
      let active = true;
      let mutation: GraphEditResult<T>['mutation'];
      try {
        const value = await write({signal: options.signal, markChanged: (...paths) => {
          if (!active) throw new Error('Changed paths must be recorded inside the edit callback.');
          if (!paths.length) throw new Error('Record at least one changed file path.');
          for (const file of this.recordChanges(paths)) changed.add(file);
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
      const timer = setTimeout(() => cleanup.abort(timeout), this.cleanupTimeoutMs);
      timer.unref();
      try {
        const {freshness} = await this.reconcile({signal: cleanup.signal});
        return {mutation, graph: {state: 'synchronized', freshness}};
      } catch (error) {
        const failure = cleanup.signal.aborted ? timeout : error instanceof GraphCoordinatorError ? error
          : new GraphCoordinatorError('sync_failed', 'Graph synchronization after the edit failed.', undefined, {cause: error});
        this.lastError = failure;
        return {mutation, graph: {state: 'failed', error: failure}};
      } finally {clearTimeout(timer);}
    }, options.signal);
  }

  /** Stop admission, drain queued operations, then close SQLite. */
  close(): Promise<void> {
    if (!this.closing) {
      this.operation = 'closing';
      this.closing = this.tail.then(async () => {
        try {await this.graph.close();} finally {this.operation = 'closed';}
      });
    }
    return this.closing;
  }
}
