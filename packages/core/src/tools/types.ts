import type {GraphCoordinator, GraphCoordinatorStatus} from '@codeyantram/graph';
import type {ToolResult} from '@codeyantram/shared';

/** Supplied by the host; model arguments never select a workspace or database. */
export interface NavigationGraphService {
  query: GraphCoordinator['query'];
  getStatus(): {lifecycle: string; graph: GraphCoordinatorStatus | null};
}

/** Shared per-turn execution policy, injected into each tool definition. */
export type NavigationExecutor = (
  name: string,
  id: string,
  signal: AbortSignal | undefined,
  run: () => Promise<unknown>,
) => Promise<ToolResult>;
