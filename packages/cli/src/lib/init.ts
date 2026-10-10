import {acquireGraphCoordinator, GraphCoordinatorError, type GraphCoordinatorLease, type GraphIndexReport, type GraphProgress, type GraphStatus, type GraphInitialization, type GraphReconcileOptions} from '@codeyantram/graph';

const SIGINT_EXIT_CODE = 130;
const SIGTERM_EXIT_CODE = 143;
const PROGRESS_INTERVAL_MS = 1000;
const MAX_INDEX_DIAGNOSTICS = 20;

interface InitOutput {
  stdout?: {write(text: string): unknown};
  stderr?: {write(text: string): unknown};
  signal?: AbortSignal;
  handleSignals?: boolean;
  onProgress?: (progress: GraphProgress) => void;
  onReady?: (status: GraphStatus) => void;
}

/** Standalone graph initialization; no chat server, provider calls, or Ink UI. */
export async function runInit(workspaceRoot: string, output: InitOutput = {}): Promise<number> {
  const stdout = output.stdout ?? process.stdout;
  const stderr = output.stderr ?? process.stderr;
  const controller = new AbortController();
  const signal = output.signal ? AbortSignal.any([controller.signal, output.signal]) : controller.signal;
  let interruptedExitCode: number | undefined;
  const interrupt = (exitCode: number) => {
    interruptedExitCode ??= exitCode;
    controller.abort();
  };
  const onInterrupt = () => interrupt(SIGINT_EXIT_CODE);
  const onTerminate = () => interrupt(SIGTERM_EXIT_CODE);
  if (output.handleSignals !== false) {
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
  }
  let lease: GraphCoordinatorLease | undefined;
  let exitCode = 0;
  let completed: string | undefined;
  let readyStatus: GraphStatus | undefined;
  let lastPhase: GraphProgress['phase'] | undefined;
  let lastProgressAt = 0;
  const onProgress = (progress: GraphProgress) => {
    if (signal.aborted) return;
    const now = Date.now();
    if (progress.phase !== lastPhase || now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
      stdout.write(`  ${progress.phase}: ${progress.current}/${progress.total}\n`);
      lastPhase = progress.phase;
      lastProgressAt = now;
      output.onProgress?.(progress);
    }
  };
  const diagnostics = (report: GraphIndexReport) => {
    for (const error of report.errors.slice(0, MAX_INDEX_DIAGNOSTICS)) {
      stderr.write(`${error.severity}: ${(error.filePath !== undefined && error.filePath !== '') ? `${error.filePath}: ` : ''}${error.message}\n`);
    }
    if (report.errors.length > MAX_INDEX_DIAGNOSTICS) stderr.write(`${report.errors.length - MAX_INDEX_DIAGNOSTICS} additional indexing diagnostics omitted.\n`);
  };

  try {
    signal.throwIfAborted();
    stdout.write(`Preparing graph for ${workspaceRoot}\n`);
    lease = await acquireGraphCoordinator(workspaceRoot);
    stdout.write(`Database: ${lease.coordinator.storage.databasePath}\n`);
    signal.throwIfAborted();
    const result = await lease.coordinator.initialize({signal, onProgress,
      onOperation: operation => stdout.write(operation === 'index' ? 'Indexing project…\n' : 'Refreshing existing graph…\n'),
    });
    if (result.index) {
      const report = result.index;
      diagnostics(report);
      stdout.write(`Indexed ${report.filesIndexed} files; ${report.filesSkipped} skipped; ${report.filesSkippedUnsupported ?? 0} unsupported.\n`);
    }
    if (result.sync) {
      const report = result.sync;
      stdout.write(`Synced ${report.filesAdded} added, ${report.filesModified} modified, ${report.filesRemoved} removed files.\n`);
    }
    const ready = result.status;
    readyStatus = ready;
    completed = `Graph ready: ${ready.fileCount} files, ${ready.nodeCount} symbols, ${ready.edgeCount} relationships.\n`;
  } catch (error) {
    if (!signal.aborted) {
      if (error instanceof GraphCoordinatorError && error.report) {
        if ('errors' in error.report) diagnostics(error.report);
        else for (const file of error.report.failedFilePaths.slice(0, MAX_INDEX_DIAGNOSTICS)) stderr.write(`Failed to index: ${file}\n`);
      }
      stderr.write(`Could not initialize graph: ${error instanceof Error ? error.message : 'Unknown indexing error.'}\n`);
      exitCode = 1;
    }
  } finally {
    try {
      await lease?.release();
    } catch (error) {
      stderr.write(`Could not close graph: ${error instanceof Error ? error.message : 'Unknown cleanup error.'}\n`);
      exitCode = 1;
    }
    if (output.handleSignals !== false) {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
    }
  }
  if (signal.aborted) {
    stderr.write('Graph initialization cancelled. Run init again to complete it.\n');
    return interruptedExitCode ?? SIGINT_EXIT_CODE;
  }
  if (!exitCode && (completed !== undefined && completed !== '') && readyStatus) {
    stdout.write(completed);
    output.onReady?.(readyStatus);
  }
  return exitCode;
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
