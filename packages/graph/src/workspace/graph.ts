import type {SymbolReference} from '@codeyantram/shared';
import type {CoordinatedGraph, GraphIndexOptions} from '../contracts/graph.js';
import type {GraphStoragePaths} from '../contracts/storage.js';
import type {GraphExploreOptions, GraphFindOptions, GraphInspectOptions, GraphInspectTarget, GraphTraceOptions} from '../contracts/navigation.js';
import {connectWorkspace} from '../sdk/connection.js';
import type {WorkspaceBackend} from '../sdk/ports.js';
import {ExploreQuery} from '../navigation/explore.js';
import {FindQuery} from '../navigation/find.js';
import {InspectQuery} from '../navigation/inspect.js';
import {TraceQuery} from '../navigation/trace.js';
import {SymbolReferences} from '../navigation/references.js';
import {SourceVerifier} from '../navigation/source-verifier.js';
import {GraphIndexing} from './indexing.js';
import {WorkspaceLifecycle} from './lifecycle.js';
import {GraphLookups} from './lookups.js';

const DEFAULT_SEARCH_LIMIT = 20;

/** Public composition facade; synchronization policy belongs to the coordinator. */
export class WorkspaceGraph implements CoordinatedGraph {
  private readonly lifecycle: WorkspaceLifecycle;
  private readonly indexing: GraphIndexing;
  private readonly lookups: GraphLookups;
  private readonly exploration: ExploreQuery;
  private readonly finding: FindQuery;
  private readonly inspection: InspectQuery;
  private readonly tracing: TraceQuery;

  private constructor(
    readonly storage: Readonly<GraphStoragePaths>,
    readonly created: boolean,
    backend: WorkspaceBackend,
  ) {
    const sources = new SourceVerifier(backend, storage);
    const references = new SymbolReferences(backend, sources, storage.workspaceId);
    this.lifecycle = new WorkspaceLifecycle(backend);
    this.indexing = new GraphIndexing(backend);
    this.lookups = new GraphLookups(backend);
    this.exploration = new ExploreQuery(backend, sources, references);
    this.finding = new FindQuery(backend, sources, references);
    this.inspection = new InspectQuery(backend, sources, references);
    this.tracing = new TraceQuery(backend, sources, references);
  }

  static async open(workspaceRoot: string): Promise<WorkspaceGraph> {
    const {storage, created, backend} = await connectWorkspace(workspaceRoot);
    return new WorkspaceGraph(storage, created, backend);
  }

  getStatus() {
    this.lifecycle.assertQueryable();
    return this.indexing.getStatus();
  }

  index(options: GraphIndexOptions = {}) {
    return this.lifecycle.run(() => this.indexing.index(options));
  }

  sync(options: GraphIndexOptions = {}) {
    return this.lifecycle.run(() => this.indexing.sync(options));
  }

  search(query: string, limit = DEFAULT_SEARCH_LIMIT) {
    this.lifecycle.assertQueryable();
    return this.lookups.search(query, limit);
  }

  getSymbol(id: string) {
    this.lifecycle.assertQueryable();
    return this.lookups.getSymbol(id);
  }

  getSource(id: string) {
    this.lifecycle.assertQueryable();
    return this.lifecycle.run(() => this.lookups.getSource(id));
  }

  getCallers(id: string, depth = 1) {
    this.lifecycle.assertQueryable();
    return this.lookups.getCallers(id, depth);
  }

  getCallees(id: string, depth = 1) {
    this.lifecycle.assertQueryable();
    return this.lookups.getCallees(id, depth);
  }

  explore(query: string, options: GraphExploreOptions = {}) {
    this.lifecycle.assertQueryable();
    return this.lifecycle.run(() => this.exploration.execute(query, options));
  }

  find(query: string, options: GraphFindOptions = {}) {
    this.lifecycle.assertQueryable();
    return this.lifecycle.run(() => this.finding.execute(query, options));
  }

  inspect(target: GraphInspectTarget, options: GraphInspectOptions = {}) {
    this.lifecycle.assertQueryable();
    return this.lifecycle.run(() => this.inspection.execute(target, options));
  }

  trace(reference: SymbolReference, options: GraphTraceOptions) {
    this.lifecycle.assertQueryable();
    return this.lifecycle.run(() => this.tracing.execute(reference, options));
  }

  close(): Promise<void> {return this.lifecycle.close();}
}

/** Opens persisted state or an empty index; index() builds the initial baseline. */
export const openWorkspaceGraph = (workspaceRoot: string): Promise<WorkspaceGraph> => WorkspaceGraph.open(workspaceRoot);
