import type {GraphCoordinator, GraphCoordinatorStatus} from '@codeyantram/graph';
import type {ToolExecutor} from '../types.js';

/** Supplied by the host; model arguments never select a workspace or database. */
export interface NavigationGraphService {
  query: GraphCoordinator['query'];
  getStatus(): {lifecycle: string; graph: GraphCoordinatorStatus | null};
}

export type NavigationExecutor = ToolExecutor;
