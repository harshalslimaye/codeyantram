import type {Node as CodeGraphNode} from '@colbymchenry/codegraph';
import type {GraphExploreContext, GraphExploreOptions} from '../contracts/navigation.js';
import type {ExploreBackend} from '../sdk/ports.js';
import {boundedInteger} from './budget.js';
import type {SourceFingerprints, SymbolReferenceFactory} from './ports.js';
import {GraphNavigationError, GraphSourceChangedError} from './errors.js';
import {toSymbol} from './symbols.js';

/** Assembles bounded SDK context and verifies every included source file. */
export class ExploreQuery {
  constructor(private readonly backend: ExploreBackend, private readonly sources: SourceFingerprints,
    private readonly references: SymbolReferenceFactory) {}

  execute(query: string, options: GraphExploreOptions = {}): Promise<GraphExploreContext> {
    if (!query.trim() || query.length > 1024) throw new Error('Explore requires between 1 and 1024 characters.');
    const maxNodes = boundedInteger(options.maxNodes ?? 12, 'Explore node limit', 20);
    const maxCharacters = boundedInteger(options.maxCharacters ?? 12_000, 'Explore context budget', 24_000);
    if (maxCharacters < 2048) throw new Error('Explore context budget must be at least 2048 characters.');
    return this.assemble(query, maxNodes, maxCharacters);
  }

  private async assemble(query: string, maxNodes: number, maxCharacters: number): Promise<GraphExploreContext> {
    const formatted = await this.backend.buildContext(query, {
      format: 'json', includeCode: false, maxNodes, searchLimit: Math.min(maxNodes, 5), traversalDepth: 1,
    });
    // The SDK's JSON format is a string with arrays, not its raw TaskContext
    // (whose subgraph contains a Map). Keep that format detail at the boundary.
    if (typeof formatted !== 'string') throw new Error('Unexpected CodeGraph context format.');
    const context = JSON.parse(formatted) as {
      summary: string; nodes: CodeGraphNode[];
      edges: {source: string; target: string; kind: string; line?: number; column?: number}[];
    };
    if (typeof context.summary !== 'string' || !Array.isArray(context.nodes) || !Array.isArray(context.edges)) {
      throw new Error('Unexpected CodeGraph context structure.');
    }
    const result: GraphExploreContext = {
      query, summary: context.summary.slice(0, 1024), symbols: [], relationships: [], snippets: [], relatedFiles: [],
      truncated: context.nodes.length >= maxNodes,
      coverage: 'Indexed scope only: gitignore, project configuration, and supported languages apply. Empty results do not prove absence.',
    };
    const fingerprints = new Map<string, string>();
    const fingerprint = async (filePath: string) => {
      try {return await this.sources.fingerprint(filePath);}
      catch (error) {
        if (error instanceof GraphNavigationError) {
          if (error.code === 'source_too_large') return null;
          throw new GraphSourceChangedError();
        }
        throw error;
      }
    };
    for (const node of context.nodes.slice(0, maxNodes)) {
      const hash = fingerprints.get(node.filePath) ?? await fingerprint(node.filePath);
      if (!hash) {result.truncated = true; continue;}
      fingerprints.set(node.filePath, hash);
      const symbol = toSymbol(node);
      // Avoid returning unbounded docstrings/signatures alongside bounded code.
      delete symbol.docstring;
      if (symbol.signature) symbol.signature = symbol.signature.slice(0, 512);
      const metadataTruncated = Boolean(node.docstring) || (node.signature?.length ?? 0) > 512;
      result.symbols.push({...symbol, reference: this.references.reference(node, hash), metadataTruncated});
      if (metadataTruncated) result.truncated = true;
      if (result.snippets.length < 5) {
        const source = await this.backend.getCode(node.id);
        if (source !== null) {
          result.snippets.push({symbolId: node.id, filePath: node.filePath, startLine: node.startLine,
            endLine: node.endLine, contentHash: hash, text: source.slice(0, 1600), truncated: source.length > 1600});
          if (source.length > 1600) result.truncated = true;
        }
      } else {result.truncated = true;}
    }
    for (const [file, hash] of fingerprints) if (await fingerprint(file) !== hash) throw new GraphSourceChangedError();
    const ids = new Set(result.symbols.map(symbol => symbol.id));
    for (const edge of context.edges) {
      if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
      if (result.relationships.length >= 40) {result.truncated = true; break;}
      result.relationships.push({source: edge.source, target: edge.target, kind: edge.kind,
        metadata: {...(edge.line === undefined ? {} : {line: edge.line}), ...(edge.column === undefined ? {} : {column: edge.column})}});
    }
    result.relatedFiles = [...new Set(result.symbols.map(symbol => symbol.filePath))];
    while (JSON.stringify(result).length > maxCharacters) {
      result.truncated = true;
      if (result.snippets.length) result.snippets.pop();
      else if (result.relationships.length) result.relationships.pop();
      else if (result.symbols.length) {
        result.symbols.pop(); result.relatedFiles = [...new Set(result.symbols.map(symbol => symbol.filePath))];
      } else {result.summary = ''; break;}
    }
    return result;
  }
}
