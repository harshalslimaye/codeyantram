import type {GraphIndexOptions, GraphIndexReport, GraphSyncReport, GraphStatus} from './graph.js';
import type {GraphCoordinatorError} from '../coordination/errors.js';

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
