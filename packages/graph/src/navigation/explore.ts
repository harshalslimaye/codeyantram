import type {Node as CodeGraphNode} from '@colbymchenry/codegraph';
import type {GraphExploreContext, GraphExploreOptions} from '../contracts/navigation.js';
import type {ExploreBackend} from '../sdk/ports.js';
import {boundedInteger} from './budget.js';
import type {SourceFingerprints, SymbolReferenceFactory} from './ports.js';
import {GraphNavigationError, GraphSourceChangedError} from './errors.js';
import {toSymbol} from './symbols.js';

const MAX_QUERY_AND_SUMMARY_CHARACTERS = 1024;
const DEFAULT_NODE_LIMIT = 12;
const MAX_NODE_LIMIT = 20;
const DEFAULT_CONTEXT_CHARACTERS = 12_000;
const MAX_CONTEXT_CHARACTERS = 24_000;
const MIN_CONTEXT_CHARACTERS = 2048;
const MAX_SEARCH_AND_SNIPPET_COUNT = 5;
const MAX_SIGNATURE_CHARACTERS = 512;
const MAX_SNIPPET_CHARACTERS = 1600;
const MAX_RELATIONSHIPS = 40;

/** Assembles bounded SDK context and verifies every included source file. */
export class ExploreQuery {
  constructor(private readonly backend: ExploreBackend, private readonly sources: SourceFingerprints,
    private readonly references: SymbolReferenceFactory) {}

  execute(query: string, options: GraphExploreOptions = {}): Promise<GraphExploreContext> {
    if (!query.trim() || query.length > MAX_QUERY_AND_SUMMARY_CHARACTERS) throw new Error('Explore requires between 1 and 1024 characters.');
    const maxNodes = boundedInteger(options.maxNodes ?? DEFAULT_NODE_LIMIT, 'Explore node limit', MAX_NODE_LIMIT);
    const maxCharacters = boundedInteger(options.maxCharacters ?? DEFAULT_CONTEXT_CHARACTERS, 'Explore context budget', MAX_CONTEXT_CHARACTERS);
    if (maxCharacters < MIN_CONTEXT_CHARACTERS) throw new Error('Explore context budget must be at least 2048 characters.');
    return this.assemble(query, maxNodes, maxCharacters);
  }

  private async assemble(query: string, maxNodes: number, maxCharacters: number): Promise<GraphExploreContext> {
    const formatted = await this.backend.buildContext(query, {
      format: 'json', includeCode: false, maxNodes, searchLimit: Math.min(maxNodes, MAX_SEARCH_AND_SNIPPET_COUNT), traversalDepth: 1,
    });
    const context = parseContext(formatted);
    const result: GraphExploreContext = {
      query, summary: context.summary.slice(0, MAX_QUERY_AND_SUMMARY_CHARACTERS), symbols: [], relationships: [], snippets: [], relatedFiles: [],
      truncated: context.nodes.length >= maxNodes,
      coverage: 'Indexed scope only: gitignore, project configuration, and supported languages apply. Empty results do not prove absence.',
    };
    const fingerprints = new Map<string, string>();
    for (const node of context.nodes.slice(0, maxNodes)) await this.addNode(node, {result, fingerprints});
    for (const [file, hash] of fingerprints) if (await this.fingerprint(file) !== hash) throw new GraphSourceChangedError();
    addRelationships(context.edges, result);
    result.relatedFiles = [...new Set(result.symbols.map(symbol => symbol.filePath))];
    trimContext(result, maxCharacters);
    return result;
  }
  private async fingerprint(filePath: string) {
    try {return await this.sources.fingerprint(filePath);}
    catch (error) {
      if (error instanceof GraphNavigationError) {
        if (error.code === 'source_too_large') return null;
        throw new GraphSourceChangedError();
      }
      throw error;
    }
  }

  private async addNode(node: CodeGraphNode, context: {result: GraphExploreContext; fingerprints: Map<string, string>}) {
    const {result, fingerprints} = context;
      const hash = fingerprints.get(node.filePath) ?? await this.fingerprint(node.filePath);
      if (hash === null || hash === '') {result.truncated = true; return;}
      fingerprints.set(node.filePath, hash);
      const symbol = toSymbol(node);
      // Avoid returning unbounded docstrings/signatures alongside bounded code.
      delete symbol.docstring;
      if (symbol.signature !== undefined && symbol.signature !== '') symbol.signature = symbol.signature.slice(0, MAX_SIGNATURE_CHARACTERS);
      const metadataTruncated = Boolean(node.docstring) || (node.signature?.length ?? 0) > MAX_SIGNATURE_CHARACTERS;
      result.symbols.push({...symbol, reference: this.references.reference(node, hash), metadataTruncated});
      if (metadataTruncated) result.truncated = true;
      await this.addSnippet(node, hash, result);
  }

  private async addSnippet(node: CodeGraphNode, hash: string, result: GraphExploreContext) {
    if (result.snippets.length < MAX_SEARCH_AND_SNIPPET_COUNT) {
      const source = await this.backend.getCode(node.id);
      if (source !== null) {
        result.snippets.push({symbolId: node.id, filePath: node.filePath, startLine: node.startLine,
          endLine: node.endLine, contentHash: hash, text: source.slice(0, MAX_SNIPPET_CHARACTERS), truncated: source.length > MAX_SNIPPET_CHARACTERS});
        if (source.length > MAX_SNIPPET_CHARACTERS) result.truncated = true;
      }
    } else {result.truncated = true;}
  }

}

type ExploreContext = {summary: string; nodes: CodeGraphNode[]; edges: {source: string; target: string; kind: string; line?: number; column?: number}[]};

function parseContext(formatted: unknown): ExploreContext {
  // The SDK's JSON format is a string with arrays, not its raw TaskContext
  // (whose subgraph contains a Map). Keep that format detail at the boundary.
  if (typeof formatted !== 'string') throw new TypeError('Unexpected CodeGraph context format.');
  const context = JSON.parse(formatted) as ExploreContext;
  if (typeof context.summary !== 'string' || !Array.isArray(context.nodes) || !Array.isArray(context.edges)) {
    throw new TypeError('Unexpected CodeGraph context structure.');
  }
  return context;
}

function addRelationships(edges: ExploreContext['edges'], result: GraphExploreContext) {
  const ids = new Set(result.symbols.map(symbol => symbol.id));
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    if (result.relationships.length >= MAX_RELATIONSHIPS) {result.truncated = true; break;}
    result.relationships.push({source: edge.source, target: edge.target, kind: edge.kind,
      metadata: {...(edge.line === undefined ? {} : {line: edge.line}), ...(edge.column === undefined ? {} : {column: edge.column})}});
  }
}

function trimContext(result: GraphExploreContext, maxCharacters: number) {
  while (JSON.stringify(result).length > maxCharacters) {
    result.truncated = true;
    if (result.snippets.length) result.snippets.pop();
    else if (result.relationships.length) result.relationships.pop();
    else if (result.symbols.length) {
      result.symbols.pop(); result.relatedFiles = [...new Set(result.symbols.map(symbol => symbol.filePath))];
    } else {result.summary = ''; break;}
  }
}
