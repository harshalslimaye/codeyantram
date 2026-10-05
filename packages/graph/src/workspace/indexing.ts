import type {IndexProgress} from '@colbymchenry/codegraph';
import type {GraphIndex, GraphIndexOptions, GraphIndexReport, GraphSyncReport, GraphStatus} from '../contracts/graph.js';
import type {IndexBackend} from '../sdk/ports.js';

/** Adapts SDK index/sync reports without owning scheduling or freshness policy. */
export class GraphIndexing implements GraphIndex {
  constructor(private readonly backend: IndexBackend) {}

  getStatus(): GraphStatus {
    const stats = this.backend.getStats();
    return {
      indexState: this.backend.getIndexState(), needsReindex: this.backend.isIndexStale(),
      lastIndexedAt: this.backend.getLastIndexedAt(), fileCount: stats.fileCount,
      nodeCount: stats.nodeCount, edgeCount: stats.edgeCount,
    };
  }

  async index(options: GraphIndexOptions = {}): Promise<GraphIndexReport> {
    const report = await this.backend.indexAll({
      signal: options.signal,
      onProgress: options.onProgress && ((progress: IndexProgress) => options.onProgress!({...progress})),
    });
    const state = this.backend.getIndexState();
    return {
      success: report.success && report.filesErrored === 0 && state === 'complete', state,
      filesIndexed: report.filesIndexed, filesSkipped: report.filesSkipped, filesErrored: report.filesErrored,
      filesDiscovered: report.filesDiscovered, filesSkippedUnsupported: report.filesSkippedUnsupported,
      nodesCreated: report.nodesCreated, edgesCreated: report.edgesCreated, durationMs: report.durationMs,
      errors: report.errors.map(error => ({...error})),
    };
  }

  async sync(options: GraphIndexOptions = {}): Promise<GraphSyncReport> {
    const report = await this.backend.sync(options);
    const failedFilePaths = report.failedFilePaths ?? [];
    return {
      success: !options.signal?.aborted && failedFilePaths.length === 0,
      filesChecked: report.filesChecked, filesAdded: report.filesAdded, filesModified: report.filesModified,
      filesRemoved: report.filesRemoved, nodesUpdated: report.nodesUpdated, durationMs: report.durationMs,
      changedFilePaths: [...report.changedFilePaths ?? []], failedFilePaths: [...failedFilePaths],
    };
  }
}
