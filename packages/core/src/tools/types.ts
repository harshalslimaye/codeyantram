import type {ToolResult} from '@codeyantram/shared';

/** Shared per-turn execution policy, injected into each tool definition. */
export type ToolExecutor = (
  name: string,
  id: string,
  signal: AbortSignal | undefined,
  run: () => Promise<unknown>,
) => Promise<ToolResult>;
