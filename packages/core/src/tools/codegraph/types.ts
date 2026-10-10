import type {GraphCoordinator, GraphCoordinatorStatus} from '@codeyantram/graph';
import type {ToolExecutor} from '../types.js';
import type {EvaluationMetadata, JevCapability} from '../../evaluation/index.js';

/** Supplied by the host; model arguments never select a workspace or database. */
export interface NavigationGraphService {
  query: GraphCoordinator['query'];
  getStatus(): {lifecycle: string; graph: GraphCoordinatorStatus | null};
}

export type NavigationExecutor = ToolExecutor;

export interface NavigationEvaluationOptions {
  jev?: JevCapability;
  objective?: string;
}

export interface NavigationFilteringMetadata extends EvaluationMetadata {
  mode: 'filter' | 'rank';
  totalCandidates: number;
  evaluatedCandidates: number;
  retainedCandidates: number;
}
