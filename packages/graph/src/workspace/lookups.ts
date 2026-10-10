import type {GraphSearchResult, GraphSymbol, GraphRelationship} from '../contracts/graph.js';
import type {LookupBackend} from '../sdk/ports.js';
import {boundedInteger} from '../navigation/budget.js';
import {toSymbol} from '../navigation/symbols.js';

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_QUERY_CHARACTERS = 1024;
const MAX_SEARCH_LIMIT = 100;
const MAX_TRAVERSAL_DEPTH = 5;

/** Maps low-level SDK lookups into the public graph model. */
export class GraphLookups {
  constructor(private readonly backend: LookupBackend) {}

  search(query: string, limit = DEFAULT_SEARCH_LIMIT): GraphSearchResult[] {
    if (!query.trim() || query.length > MAX_QUERY_CHARACTERS) throw new Error('A graph search requires between 1 and 1024 characters.');
    return this.backend.searchNodes(query, {limit: boundedInteger(limit, 'Search limit', MAX_SEARCH_LIMIT)})
      .map(result => ({symbol: toSymbol(result.node), score: result.score}));
  }

  getSymbol(id: string): GraphSymbol | null {
    const node = this.backend.getNode(id);
    return node ? toSymbol(node) : null;
  }

  getSource(id: string): Promise<string | null> {
    return this.backend.getCode(id);
  }

  getCallers(id: string, depth = 1): GraphRelationship[] {
    return this.backend.getCallers(id, boundedInteger(depth, 'Traversal depth', MAX_TRAVERSAL_DEPTH))
      .map(({node, edge}) => ({symbol: toSymbol(node), kind: edge.kind, source: edge.source, target: edge.target, metadata: edge.metadata}));
  }

  getCallees(id: string, depth = 1): GraphRelationship[] {
    return this.backend.getCallees(id, boundedInteger(depth, 'Traversal depth', MAX_TRAVERSAL_DEPTH))
      .map(({node, edge}) => ({symbol: toSymbol(node), kind: edge.kind, source: edge.source, target: edge.target, metadata: edge.metadata}));
  }

}
