import {mkdir, stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import type {CodeGraph, IndexProgress, IndexResult, SyncResult, Node as CodeGraphNode} from '@colbymchenry/codegraph';
import {resolveGraphStoragePaths, type GraphStoragePaths} from './storage.js';

export interface GraphSymbol {
  id: string;
  kind: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  signature?: string;
  docstring?: string;
}

export interface GraphSearchResult {
  symbol: GraphSymbol;
  score: number;
}

export interface GraphRelationship {
  symbol: GraphSymbol;
  kind: string;
  source: string;
  target: string;
  metadata?: Record<string, unknown>;
}

export interface GraphProgress {
  phase: 'scanning' | 'parsing' | 'storing' | 'resolving' | 'linking';
  current: number;
  total: number;
  currentFile?: string;
}

export interface GraphIndexOptions {
  signal?: AbortSignal;
  onProgress?: (progress: GraphProgress) => void;
}

export interface GraphIndexReport {
  success: boolean;
  state: GraphIndexState;
  filesIndexed: number;
  filesSkipped: number;
  filesErrored: number;
  filesDiscovered?: number;
  filesSkippedUnsupported?: number;
  nodesCreated: number;
  edgesCreated: number;
  durationMs: number;
  errors: {message: string; severity: 'error' | 'warning'; filePath?: string; code?: string}[];
}

export interface GraphSyncReport {
  success: boolean;
  filesChecked: number;
  filesAdded: number;
  filesModified: number;
  filesRemoved: number;
  nodesUpdated: number;
  durationMs: number;
  changedFilePaths: string[];
  failedFilePaths: string[];
}

export type GraphIndexState = 'indexing' | 'complete' | 'partial' | 'failed' | null;

export interface GraphStatus {
  indexState: GraphIndexState;
  needsReindex: boolean;
  lastIndexedAt: number | null;
  fileCount: number;
  nodeCount: number;
  edgeCount: number;
}

type SDK = typeof import('@colbymchenry/codegraph');
type EmbeddedSDK = Omit<SDK, 'CodeGraph'> & {
  CodeGraph: SDK['CodeGraph'] & {
    // The tracked install-time extension; no private fields or runtime overrides.
    connect(root: string, databasePath: string, options: {create: boolean}): Promise<CodeGraph>;
  };
};

function loadSDK(): EmbeddedSDK {
  // The npm shim is CommonJS and exposes an object, not the class as an ESM
  // default export. Keep this detail inside the adapter and load it on demand.
  const sdk = createRequire(import.meta.url)('@colbymchenry/codegraph') as EmbeddedSDK;
  if (typeof sdk.CodeGraph.connect !== 'function') {
    throw new Error('CodeGraph external storage is unavailable. Run npm install to apply the Codeyantram storage extension.');
  }
  return sdk;
}

function toSymbol(node: CodeGraphNode): GraphSymbol {
  return {
    id: node.id, kind: node.kind, name: node.name, qualifiedName: node.qualifiedName,
    filePath: node.filePath, language: node.language, startLine: node.startLine, endLine: node.endLine,
    ...(node.signature === undefined ? {} : {signature: node.signature}),
    ...(node.docstring === undefined ? {} : {docstring: node.docstring}),
  };
}

function boundedInteger(value: number, name: string, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

/** Workspace-bound SDK adapter. Synchronization policy belongs to the coordinator. */
export class WorkspaceGraph {
  private closing?: Promise<void>;
  private pending = new Set<Promise<unknown>>();

  private constructor(
    readonly storage: Readonly<GraphStoragePaths>,
    readonly created: boolean,
    private readonly backend: CodeGraph,
  ) {}

  static async open(workspaceRoot: string): Promise<WorkspaceGraph> {
    const storage = await resolveGraphStoragePaths(workspaceRoot);
    const sdk = loadSDK();
    await mkdir(storage.directory, {recursive: true, mode: 0o700});
    // Schema creation/opening must not race another process's initialization or
    // indexing. The SDK uses this same global lock for indexAll and sync.
    const lock = new sdk.FileLock(storage.lockPath);
    lock.acquire();
    try {
      let created = false;
      try {
        if (!(await stat(storage.databasePath)).isFile()) throw new Error('The graph database path must be a file.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        created = true;
      }
      const backend = await sdk.CodeGraph.connect(storage.workspaceRoot, storage.databasePath, {create: created});
      return new WorkspaceGraph(Object.freeze(storage), created, backend);
    } finally {
      lock.release();
    }
  }

  private assertOpen() {
    if (this.closing) throw new Error('The workspace graph is closing or closed.');
  }

  private assertQueryable() {
    this.assertOpen();
    if (this.backend.isIndexing()) throw new Error('The workspace graph is indexing. Wait for indexing to complete.');
    // Other processes may have updated or replaced this workspace's index.
    this.backend.reopenIfReplaced();
    this.backend.dropReadCaches();
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen();
    const pending = operation();
    this.pending.add(pending);
    // Both handlers resolve: cleanup must not create an unhandled rejection.
    void pending.then(() => this.pending.delete(pending), () => this.pending.delete(pending));
    return pending;
  }

  getStatus(): GraphStatus {
    this.assertQueryable();
    const stats = this.backend.getStats();
    return {
      indexState: this.backend.getIndexState(), needsReindex: this.backend.isIndexStale(),
      lastIndexedAt: this.backend.getLastIndexedAt(), fileCount: stats.fileCount,
      nodeCount: stats.nodeCount, edgeCount: stats.edgeCount,
    };
  }

  index(options: GraphIndexOptions = {}): Promise<GraphIndexReport> {
    return this.run(async () => {
      const report: IndexResult = await this.backend.indexAll({
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
    });
  }

  sync(options: GraphIndexOptions = {}): Promise<GraphSyncReport> {
    return this.run(async () => {
      const report: SyncResult = await this.backend.sync(options);
      const failedFilePaths = report.failedFilePaths ?? [];
      return {
        success: !options.signal?.aborted && failedFilePaths.length === 0,
        filesChecked: report.filesChecked, filesAdded: report.filesAdded, filesModified: report.filesModified,
        filesRemoved: report.filesRemoved, nodesUpdated: report.nodesUpdated, durationMs: report.durationMs,
        changedFilePaths: [...report.changedFilePaths ?? []], failedFilePaths: [...failedFilePaths],
      };
    });
  }

  search(query: string, limit = 20): GraphSearchResult[] {
    this.assertQueryable();
    if (!query.trim() || query.length > 1024) throw new Error('A graph search requires between 1 and 1024 characters.');
    return this.backend.searchNodes(query, {limit: boundedInteger(limit, 'Search limit', 100)})
      .map(result => ({symbol: toSymbol(result.node), score: result.score}));
  }

  getSymbol(id: string): GraphSymbol | null {
    this.assertQueryable();
    const node = this.backend.getNode(id);
    return node ? toSymbol(node) : null;
  }

  getSource(id: string): Promise<string | null> {
    this.assertQueryable();
    return this.run(() => this.backend.getCode(id));
  }

  getCallers(id: string, depth = 1): GraphRelationship[] {
    this.assertQueryable();
    return this.backend.getCallers(id, boundedInteger(depth, 'Traversal depth', 5))
      .map(({node, edge}) => ({symbol: toSymbol(node), kind: edge.kind, source: edge.source, target: edge.target, metadata: edge.metadata}));
  }

  getCallees(id: string, depth = 1): GraphRelationship[] {
    this.assertQueryable();
    return this.backend.getCallees(id, boundedInteger(depth, 'Traversal depth', 5))
      .map(({node, edge}) => ({symbol: toSymbol(node), kind: edge.kind, source: edge.source, target: edge.target, metadata: edge.metadata}));
  }

  /** Wait for admitted operations before closing SQLite; repeated closes share a promise. */
  close(): Promise<void> {
    return this.closing ??= (async () => {
      await Promise.allSettled([...this.pending]);
      this.backend.close();
    })();
  }
}

/** Opens persisted state or creates an empty index; call index() to build its baseline. */
export const openWorkspaceGraph = (workspaceRoot: string): Promise<WorkspaceGraph> => WorkspaceGraph.open(workspaceRoot);
