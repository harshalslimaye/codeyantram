import type {Edge} from '@colbymchenry/codegraph';
import type {SymbolReference} from '@codeyantram/shared';
import type {GraphTraceResult, GraphTraceOptions} from '../contracts/navigation.js';
import type {TraceBackend} from '../sdk/ports.js';
import type {SourceFingerprints, SymbolResolver, VerifiedSymbols} from './ports.js';
import {budget, fits, integer, requireFits} from './budget.js';
import {NAVIGATION_COVERAGE} from './coverage.js';
import {GraphNavigationError} from './errors.js';

const TRAVERSAL_EXTRA_NODES = 2;

const MAX_TRACE_DEPTH = 3;
const DEFAULT_RESULT_LIMIT = 20;
const MAX_RESULT_LIMIT = 50;
const MAX_RELATIONSHIPS = 100;
const MAX_EDGE_METADATA_CHARACTERS = 1024;

export class TraceQuery {
  constructor(private readonly backend: TraceBackend, private readonly sources: SourceFingerprints,
    private readonly symbols: SymbolResolver & VerifiedSymbols) {}

  async execute(reference: SymbolReference, options: GraphTraceOptions): Promise<GraphTraceResult> {
    if (!['callers', 'callees'].includes(options.direction)) throw new GraphNavigationError('invalid_input', 'Trace direction must be callers or callees.');
    const depth = integer(options.depth ?? 1, 1, MAX_TRACE_DEPTH), limit = integer(options.limit ?? DEFAULT_RESULT_LIMIT, 1, MAX_RESULT_LIMIT), maxCharacters = budget(options.maxCharacters);
    const target = await this.symbols.resolve(reference);
    const subgraph = this.backend.traverse(target.id, {direction: options.direction === 'callers' ? 'incoming' : 'outgoing',
      maxDepth: depth, limit: limit + TRAVERSAL_EXTRA_NODES, includeStart: true, edgeKinds: ['calls', 'instantiates']});
    const nodes = [...subgraph.nodes.values()].filter(node => node.id !== target.id);
    const result: GraphTraceResult = {target, direction: options.direction, depth, symbols: [], relationships: [],
      truncated: nodes.length > limit, coverage: NAVIGATION_COVERAGE + ' Trace follows resolved calls and instantiations only; dynamic or unresolved calls may be absent.'};
    const hashes = new Map([[target.filePath, target.reference.contentHash]]);
    for (const node of nodes.slice(0, limit)) {
      try {result.symbols.push(await this.symbols.verified(node, hashes));}
      catch (error) {
        if (!(error instanceof GraphNavigationError) || error.code !== 'source_too_large') throw error;
        result.truncated = true;
      }
    }
    const ids = new Set([target.id, ...result.symbols.map(symbol => symbol.id)]);
    for (const edge of subgraph.edges) {
      if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
      if (result.relationships.length >= MAX_RELATIONSHIPS) {result.truncated = true; break;}
      if (edge.metadata && JSON.stringify(edge.metadata).length > MAX_EDGE_METADATA_CHARACTERS) result.truncated = true;
      result.relationships.push(this.relationship(edge));
    }
    await this.sources.verifyFiles(hashes);
    result.truncated ||= target.metadataTruncated || result.symbols.some(symbol => symbol.metadataTruncated);
    while (!fits(result, maxCharacters)) {
      result.truncated = true;
      if (result.relationships.length) result.relationships.pop();
      else if (result.symbols.length) result.symbols.pop();
      else break;
    }
    requireFits(result, maxCharacters);
    return result;
  }

  private relationship(edge: Edge): GraphTraceResult['relationships'][number] {
    const metadata = edge.metadata && JSON.stringify(edge.metadata).length <= MAX_EDGE_METADATA_CHARACTERS ? JSON.parse(JSON.stringify(edge.metadata)) as Record<string, unknown> : undefined;
    return {source: edge.source, target: edge.target, kind: edge.kind,
      ...(edge.line === undefined ? {} : {line: edge.line}), ...(edge.column === undefined ? {} : {column: edge.column}),
      ...(metadata ? {metadata} : {})};
  }
}
