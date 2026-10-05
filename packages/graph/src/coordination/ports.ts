import type {GraphCoordinatorStatus, GraphInitialization, GraphReconcileOptions} from '../contracts/coordination.js';
import type {GraphCoordinatorError} from './errors.js';

export interface ChangeJournal {
  readonly version: number;
  readonly dirty: boolean;
  record(paths: readonly string[]): string[];
  acknowledge(generation: number): void;
  requireFullScan(): void;
}

export interface OperationState {
  setOperation(operation: GraphCoordinatorStatus['operation']): void;
}

export interface ReconcileWorkspace {
  run(options: GraphReconcileOptions): Promise<GraphInitialization>;
  recordFailure(error: GraphCoordinatorError): void;
}
