import {randomUUID} from 'node:crypto';
import type {GraphIndex, GraphIndexReport, GraphSyncReport, GraphStatus} from '../contracts/graph.js';
import type {GraphFreshness, GraphInitialization, GraphReconcileOptions} from '../contracts/coordination.js';
import type {ChangeJournal, OperationState, ReconcileWorkspace} from './ports.js';
import {GraphCoordinatorError} from './errors.js';

/** Establishes a complete baseline and records conservative freshness observations. */
export class GraphReconciler implements ReconcileWorkspace {
  private readonly epoch = randomUUID();
  private revision = 0;
  private observation: GraphFreshness | null = null;
  private index: GraphStatus | null = null;
  private failure: GraphCoordinatorError | null = null;

  constructor(private readonly graph: GraphIndex, private readonly changes: ChangeJournal,
    private readonly operations: OperationState) {}

  get freshness(): GraphFreshness | null {return this.observation && {...this.observation};}
  get indexStatus(): GraphStatus | null {return this.index && {...this.index};}
  get lastError(): GraphCoordinatorError | null {return this.failure;}

  recordFailure(error: GraphCoordinatorError): void {this.failure = error;}

  async run(options: GraphReconcileOptions): Promise<GraphInitialization> {
    let index: GraphIndexReport | undefined;
    let sync: GraphSyncReport | undefined;
    try {
      // A newer notification is never cleared by an older pass. Bound retries
      // so a continuously changing workspace cannot starve the queue forever.
      for (let pass = 0; pass < 3; pass++) {
        options.signal?.throwIfAborted();
        const generation = this.changes.version;
        const status = this.graph.getStatus();
        if (status.indexState !== 'complete' || status.needsReindex) {
          this.operations.setOperation('initializing');
          options.onOperation?.('index');
          index = await this.graph.index(options);
          options.signal?.throwIfAborted();
          if (!index.success) throw new GraphCoordinatorError('index_failed',
            `Graph indexing did not complete (state: ${index.state ?? 'uninitialized'}, ${index.filesErrored} failed files). Run init again to retry.`, index);
        } else {
          this.operations.setOperation('synchronizing');
          options.onOperation?.('sync');
          sync = await this.graph.sync(options);
          options.signal?.throwIfAborted();
          if (!sync.success) throw new GraphCoordinatorError('sync_failed',
            `Graph sync did not complete (${sync.failedFilePaths.length} failed files). Run init again to retry.`, sync);
        }
        this.index = this.graph.getStatus();
        if (this.index.indexState !== 'complete' || this.index.needsReindex) {
          throw new GraphCoordinatorError('sync_failed', 'The graph has no current, complete baseline. Run init again to retry.');
        }
        // Conservative local observation revision: even a no-op sync could
        // have observed another process's writes. Do not treat it as a DB version.
        this.observation = {epoch: this.epoch, revision: ++this.revision, reconciledAt: Date.now()};
        this.changes.acknowledge(generation);
        if (this.changes.dirty) continue;
        this.failure = null;
        return {status: {...this.index}, freshness: {...this.observation}, index, sync};
      }
      throw new GraphCoordinatorError('changes_during_sync', 'The workspace kept changing during graph synchronization. Retry the query.');
    } catch (error) {
      // Failed/cancelled sync can have written part of the index. Preserve dirty
      // state and require another reconciliation before any navigation.
      this.changes.requireFullScan();
      this.failure = error instanceof GraphCoordinatorError ? error
        : new GraphCoordinatorError('sync_failed', error instanceof Error ? error.message : 'Graph synchronization failed.', undefined, {cause: error});
      throw options.signal?.aborted ? error : this.failure;
    }
  }
}
