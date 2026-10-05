import type {GraphIndexReport, GraphSyncReport} from '../contracts/graph.js';

export class GraphCoordinatorError extends Error {
  constructor(
    readonly code: 'index_failed' | 'sync_failed' | 'changes_during_sync' | 'cleanup_timeout' | 'closed',
    message: string,
    readonly report?: GraphIndexReport | GraphSyncReport,
    options?: ErrorOptions,
  ) {super(message, options); this.name = 'GraphCoordinatorError';}
}
