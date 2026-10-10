import {
  acquireGraphCoordinator, type GraphCoordinatorLease, type GraphCoordinatorStatus,
  type GraphEditContext, type GraphEditResult, type GraphFreshness, type GraphInitialization,
  type GraphReader, type GraphReconcileOptions,
} from '@codeyantram/graph';

export interface ServerGraphStatus {
  lifecycle: 'unopened' | 'opening' | 'open' | 'closing' | 'closed';
  workspaceRoot?: string;
  graph: GraphCoordinatorStatus | null;
}

/** Server-owned lazy lease; no SQLite access or indexing during chat startup. */
export class WorkspaceGraphService {
  private opening?: Promise<GraphCoordinatorLease>;
  private lease?: GraphCoordinatorLease;
  private closing?: Promise<void>;
  private closed = false;
  private readonly shutdown = new AbortController();
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    readonly workspaceRoot: string | undefined,
    private readonly acquire: typeof acquireGraphCoordinator = acquireGraphCoordinator,
  ) {}

  getStatus(): ServerGraphStatus {
    let lifecycle: ServerGraphStatus['lifecycle'];
    if (this.closed) lifecycle = 'closed';
    else if (this.closing) lifecycle = 'closing';
    else if (this.lease) lifecycle = 'open';
    else if (this.opening) lifecycle = 'opening';
    else lifecycle = 'unopened';
    return {
      lifecycle,
      workspaceRoot: this.lease?.coordinator.storage.workspaceRoot ?? this.workspaceRoot,
      graph: this.lease?.coordinator.getStatus() ?? null,
    };
  }

  private getLease(): Promise<GraphCoordinatorLease> {
    if (this.workspaceRoot === undefined || this.workspaceRoot === '') return Promise.reject(new Error('A workspace root is required for graph operations.'));
    const workspaceRoot = this.workspaceRoot;
    return this.opening ??= Promise.resolve().then(() => this.acquire(workspaceRoot)).then(lease => {
      this.lease = lease;
      return lease;
    }, (error: unknown) => {
      this.opening = undefined;
      throw error;
    });
  }

  private run<T>(operation: (lease: GraphCoordinatorLease, signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.closing) return Promise.reject(new Error('The server workspace graph is closing or closed.'));
    const combined = signal ? AbortSignal.any([signal, this.shutdown.signal]) : this.shutdown.signal;
    const task = (async () => {
      combined.throwIfAborted();
      const lease = await this.getLease();
      combined.throwIfAborted();
      return operation(lease, combined);
    })();
    this.pending.add(task);
    void task.then(() => this.pending.delete(task), () => this.pending.delete(task));
    return task;
  }

  initialize(options: GraphReconcileOptions = {}): Promise<GraphInitialization> {
    return this.run((lease, signal) => lease.coordinator.initialize({...options, signal}), options.signal);
  }

  query<T>(read: (graph: GraphReader, freshness: GraphFreshness) => T | Promise<T>, options: GraphReconcileOptions = {}): Promise<{value: T; freshness: GraphFreshness}> {
    return this.run((lease, signal) => lease.coordinator.query(read, {...options, signal}), options.signal);
  }

  edit<T>(write: (context: GraphEditContext) => T | Promise<T>, options: {signal?: AbortSignal} = {}): Promise<GraphEditResult<T>> {
    return this.run((lease, signal) => lease.coordinator.edit(write, {signal}), options.signal);
  }

  /** Cancel server-owned operations, drain edit cleanup, then release our lease. */
  close(): Promise<void> {
    if (!this.closing) {
      // Set the admission barrier before abort listeners can submit more work.
      this.closing = Promise.resolve().then(async () => {
        await Promise.allSettled(this.pending);
        try {await this.lease?.release(); return;} finally {this.closed = true;}
      });
      this.shutdown.abort();
    }
    return this.closing;
  }
}
