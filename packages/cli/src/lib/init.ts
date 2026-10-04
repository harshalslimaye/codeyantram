import {openWorkspaceGraph, type GraphProgress, type GraphStatus, type WorkspaceGraph} from '@codeyantram/graph';

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
  const onInterrupt = () => interrupt(130);
  const onTerminate = () => interrupt(143);
  if (output.handleSignals !== false) {
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
  }
  let graph: WorkspaceGraph | undefined;
  let exitCode = 0;
  let completed: string | undefined;
  let readyStatus: GraphStatus | undefined;
  let lastPhase: GraphProgress['phase'] | undefined;
  let lastProgressAt = 0;
  const onProgress = (progress: GraphProgress) => {
    if (signal.aborted) return;
    const now = Date.now();
    if (progress.phase !== lastPhase || now - lastProgressAt >= 1000) {
      stdout.write(`  ${progress.phase}: ${progress.current}/${progress.total}\n`);
      lastPhase = progress.phase;
      lastProgressAt = now;
      output.onProgress?.(progress);
    }
  };

  try {
    signal.throwIfAborted();
    stdout.write(`Preparing graph for ${workspaceRoot}\n`);
    graph = await openWorkspaceGraph(workspaceRoot);
    stdout.write(`Database: ${graph.storage.databasePath}\n`);
    signal.throwIfAborted();
    const status = graph.getStatus();
    if (status.indexState !== 'complete' || status.needsReindex) {
      stdout.write('Indexing project…\n');
      const report = await graph.index({signal, onProgress});
      signal.throwIfAborted();
      for (const error of report.errors.slice(0, 20)) {
        stderr.write(`${error.severity}: ${error.filePath ? `${error.filePath}: ` : ''}${error.message}\n`);
      }
      if (report.errors.length > 20) stderr.write(`${report.errors.length - 20} additional indexing diagnostics omitted.\n`);
      if (!report.success) {
        throw new Error(`Graph indexing did not complete (state: ${report.state ?? 'uninitialized'}, ${report.filesErrored} failed files). Run init again to retry.`);
      }
      stdout.write(`Indexed ${report.filesIndexed} files; ${report.filesSkipped} skipped; ${report.filesSkippedUnsupported ?? 0} unsupported.\n`);
    } else {
      stdout.write('Refreshing existing graph…\n');
      const report = await graph.sync({signal, onProgress});
      signal.throwIfAborted();
      if (!report.success) {
        for (const file of report.failedFilePaths.slice(0, 20)) stderr.write(`Failed to index: ${file}\n`);
        throw new Error(`Graph sync did not complete (${report.failedFilePaths.length} failed files). Run init again to retry.`);
      }
      stdout.write(`Synced ${report.filesAdded} added, ${report.filesModified} modified, ${report.filesRemoved} removed files.\n`);
    }
    const ready = graph.getStatus();
    readyStatus = ready;
    completed = `Graph ready: ${ready.fileCount} files, ${ready.nodeCount} symbols, ${ready.edgeCount} relationships.\n`;
  } catch (error) {
    if (!signal.aborted) {
      stderr.write(`Could not initialize graph: ${error instanceof Error ? error.message : 'Unknown indexing error.'}\n`);
      exitCode = 1;
    }
  } finally {
    try {
      await graph?.close();
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
    return interruptedExitCode ?? 130;
  }
  if (!exitCode && completed && readyStatus) {
    stdout.write(completed);
    output.onReady?.(readyStatus);
  }
  return exitCode;
}

/** Palette entry uses the same initializer with UI-owned cancellation/output. */
export async function initializeGraphForUI(
  workspaceRoot: string,
  signal: AbortSignal,
  onProgress: (message: string) => void,
): Promise<string> {
  let ready: GraphStatus | undefined;
  const errors: string[] = [];
  const exitCode = await runInit(workspaceRoot, {
    signal, handleSignals: false,
    stdout: {write: () => {}},
    stderr: {write: text => {errors.push(text.trim());}},
    onProgress: progress => onProgress(`Indexing graph · ${progress.phase}: ${progress.current}/${progress.total}`),
    onReady: status => {ready = status;},
  });
  signal.throwIfAborted();
  if (exitCode !== 0 || !ready) throw new Error(errors.join('\n') || 'Graph initialization did not complete.');
  return `Graph ready: ${ready.fileCount} files, ${ready.nodeCount} symbols, ${ready.edgeCount} relationships.`;
}
