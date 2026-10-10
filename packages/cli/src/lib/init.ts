import {InitRunner} from './init-runner.js';
import {GraphCoordinatorError, type GraphProgress, type GraphStatus, type GraphInitialization, type GraphReconcileOptions} from '@codeyantram/graph';

const MAX_INDEX_DIAGNOSTICS = 20;

export interface InitOutput {
  stdout?: {write(text: string): unknown};
  stderr?: {write(text: string): unknown};
  signal?: AbortSignal;
  handleSignals?: boolean;
  onProgress?: (progress: GraphProgress) => void;
  onReady?: (status: GraphStatus) => void;
}

/** Standalone graph initialization; no chat server, provider calls, or Ink UI. */
export async function runInit(workspaceRoot: string, output: InitOutput = {}): Promise<number> {
  return new InitRunner(workspaceRoot, output).run();
}

/** Palette initialization uses the server-owned service with UI cancellation. */
export async function initializeGraphForUI(
  initialize: (options: GraphReconcileOptions) => Promise<GraphInitialization>,
  signal: AbortSignal,
  onProgress: (message: string) => void,
): Promise<string> {
  signal.throwIfAborted();
  try {
    const {status: ready} = await initialize({signal,
      onProgress: progress => {if (!signal.aborted) onProgress(`Indexing graph · ${progress.phase}: ${progress.current}/${progress.total}`);},
    });
    signal.throwIfAborted();
    return `Graph ready: ${ready.fileCount} files, ${ready.nodeCount} symbols, ${ready.edgeCount} relationships.`;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof GraphCoordinatorError && error.report) {
      const details = 'errors' in error.report
        ? error.report.errors.slice(0, MAX_INDEX_DIAGNOSTICS).map(item => `${(item.filePath !== undefined && item.filePath !== '') ? `${item.filePath}: ` : ''}${item.message}`)
        : error.report.failedFilePaths.slice(0, MAX_INDEX_DIAGNOSTICS).map(file => `Failed to index: ${file}`);
      throw new Error([error.message, ...details].join('\n'), {cause: error});
    }
    throw error;
  }
}
