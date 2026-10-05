import type {SymbolReference} from '@codeyantram/shared';
import type {GraphStoragePaths} from './storage.js';
import type {
  GraphExploreContext, GraphExploreOptions, GraphFindResult, GraphFindOptions,
  GraphInspectTarget, GraphInspectResult, GraphInspectOptions, GraphTraceResult, GraphTraceOptions,
} from './navigation.js';

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

/** Read-only domain contract; coordinators do not depend on the SDK facade. */
export interface GraphReader {
  search(query: string, limit?: number): GraphSearchResult[];
  getSymbol(id: string): GraphSymbol | null;
  getSource(id: string): Promise<string | null>;
  getCallers(id: string, depth?: number): GraphRelationship[];
  getCallees(id: string, depth?: number): GraphRelationship[];
  explore(query: string, options?: GraphExploreOptions): Promise<GraphExploreContext>;
  find(query: string, options?: GraphFindOptions): Promise<GraphFindResult>;
  inspect(target: GraphInspectTarget, options?: GraphInspectOptions): Promise<GraphInspectResult>;
  trace(reference: SymbolReference, options: GraphTraceOptions): Promise<GraphTraceResult>;
}

export interface GraphIndex {
  getStatus(): GraphStatus;
  index(options?: GraphIndexOptions): Promise<GraphIndexReport>;
  sync(options?: GraphIndexOptions): Promise<GraphSyncReport>;
}

export interface CoordinatedGraph extends GraphReader, GraphIndex {
  readonly storage: Readonly<GraphStoragePaths>;
  close(): Promise<void>;
}
