import {acquireGraphCoordinator, GraphCoordinatorError, type GraphCoordinatorLease, type GraphIndexReport, type GraphProgress, type GraphStatus, type GraphInitialization} from '@codeyantram/graph';
import type {InitOutput} from './init.js';

const SIGINT_EXIT_CODE = 130;
const SIGTERM_EXIT_CODE = 143;
const PROGRESS_INTERVAL_MS = 1000;
const MAX_INDEX_DIAGNOSTICS = 20;

export class InitRunner {
  private readonly stdout;
  private readonly stderr;
  private readonly controller = new AbortController();
  private readonly signal;
  private interruptedExitCode: number | undefined;
  private lease: GraphCoordinatorLease | undefined;
  private exitCode = 0;
  private completed: string | undefined;
  private readyStatus: GraphStatus | undefined;
  private lastPhase: GraphProgress['phase'] | undefined;
  private lastProgressAt = 0;

  constructor(private readonly workspaceRoot: string, private readonly output: InitOutput) {
    this.stdout = output.stdout ?? process.stdout;
    this.stderr = output.stderr ?? process.stderr;
    this.signal = output.signal ? AbortSignal.any([this.controller.signal, output.signal]) : this.controller.signal;
  }

  private interrupt(exitCode: number) {
    this.interruptedExitCode ??= exitCode;
    this.controller.abort();
  }
  private onInterrupt = () => {this.interrupt(SIGINT_EXIT_CODE);};
  private onTerminate = () => {this.interrupt(SIGTERM_EXIT_CODE);};

  async run(): Promise<number> {
    if (this.output.handleSignals !== false) {
      process.on('SIGINT', this.onInterrupt);
      process.on('SIGTERM', this.onTerminate);
    }
    try {
      this.signal.throwIfAborted();
      this.stdout.write(`Preparing graph for ${this.workspaceRoot}\n`);
      this.lease = await acquireGraphCoordinator(this.workspaceRoot);
      this.stdout.write(`Database: ${this.lease.coordinator.storage.databasePath}\n`);
      this.signal.throwIfAborted();
      const result = await this.lease.coordinator.initialize({signal: this.signal, onProgress: this.onProgress,
        onOperation: operation => this.stdout.write(operation === 'index' ? 'Indexing project…\n' : 'Refreshing existing graph…\n'),
      });
      this.reportResult(result);
    } catch (error) {
      this.reportFailure(error);
    } finally {
      await this.close();
    }
    return this.finish();
  }

  private onProgress = (progress: GraphProgress) => {
    if (this.signal.aborted) return;
    const now = Date.now();
    if (progress.phase !== this.lastPhase || now - this.lastProgressAt >= PROGRESS_INTERVAL_MS) {
      this.stdout.write(`  ${progress.phase}: ${progress.current}/${progress.total}\n`);
      this.lastPhase = progress.phase;
      this.lastProgressAt = now;
      this.output.onProgress?.(progress);
    }
  };

  private diagnostics(report: GraphIndexReport) {
    for (const error of report.errors.slice(0, MAX_INDEX_DIAGNOSTICS)) {
      this.stderr.write(`${error.severity}: ${(error.filePath !== undefined && error.filePath !== '') ? `${error.filePath}: ` : ''}${error.message}\n`);
    }
    if (report.errors.length > MAX_INDEX_DIAGNOSTICS) this.stderr.write(`${report.errors.length - MAX_INDEX_DIAGNOSTICS} additional indexing diagnostics omitted.\n`);
  }

  private reportResult(result: GraphInitialization) {
    if (result.index) {
      const report = result.index;
      this.diagnostics(report);
      this.stdout.write(`Indexed ${report.filesIndexed} files; ${report.filesSkipped} skipped; ${report.filesSkippedUnsupported ?? 0} unsupported.\n`);
    }
    if (result.sync) {
      const report = result.sync;
      this.stdout.write(`Synced ${report.filesAdded} added, ${report.filesModified} modified, ${report.filesRemoved} removed files.\n`);
    }
    const ready = result.status;
    this.readyStatus = ready;
    this.completed = `Graph ready: ${ready.fileCount} files, ${ready.nodeCount} symbols, ${ready.edgeCount} relationships.\n`;
  }

  private reportFailure(error: unknown) {
    if (this.signal.aborted) return;
    if (error instanceof GraphCoordinatorError && error.report) this.reportDiagnostics(error.report);
    this.stderr.write(`Could not initialize graph: ${error instanceof Error ? error.message : 'Unknown indexing error.'}\n`);
    this.exitCode = 1;
  }

  private reportDiagnostics(report: NonNullable<GraphCoordinatorError['report']>) {
    if ('errors' in report) this.diagnostics(report);
    else for (const file of report.failedFilePaths.slice(0, MAX_INDEX_DIAGNOSTICS)) this.stderr.write(`Failed to index: ${file}\n`);
  }

  private async close() {
    try {
      await this.lease?.release();
    } catch (error) {
      this.stderr.write(`Could not close graph: ${error instanceof Error ? error.message : 'Unknown cleanup error.'}\n`);
      this.exitCode = 1;
    }
    if (this.output.handleSignals !== false) {
      process.off('SIGINT', this.onInterrupt);
      process.off('SIGTERM', this.onTerminate);
    }
  }

  private finish(): number {
    if (this.signal.aborted) {
      this.stderr.write('Graph initialization cancelled. Run init again to complete it.\n');
      return this.interruptedExitCode ?? SIGINT_EXIT_CODE;
    }
    if (!this.exitCode && this.completed !== undefined && this.completed !== '' && this.readyStatus) {
      this.stdout.write(this.completed);
      this.output.onReady?.(this.readyStatus);
    }
    return this.exitCode;
  }
}
