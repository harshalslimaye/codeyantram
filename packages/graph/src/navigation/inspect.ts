import type {SymbolReference} from '@codeyantram/shared';
import {navigationFilePathSchema} from '@codeyantram/shared';
import type {GraphInspectTarget, GraphInspectResult, GraphInspectOptions} from '../contracts/navigation.js';
import type {InspectBackend} from '../sdk/ports.js';
import type {SourceFingerprints, SymbolResolver, SymbolReferenceFactory} from './ports.js';
import {budget, fits, integer, requireFits} from './budget.js';
import {NAVIGATION_COVERAGE} from './coverage.js';
import {GraphNavigationError} from './errors.js';
import {toNavigationSymbol} from './symbols.js';

const BISECTION_DIVISOR = 2;

const DEFAULT_RESULT_LIMIT = 20;
const MAX_RESULT_LIMIT = 50;

export class InspectQuery {
  constructor(private readonly backend: InspectBackend, private readonly sources: SourceFingerprints,
    private readonly symbols: SymbolResolver & SymbolReferenceFactory) {}

  async execute(target: GraphInspectTarget, options: GraphInspectOptions = {}): Promise<GraphInspectResult> {
    const maxCharacters = budget(options.maxCharacters), limit = integer(options.limit ?? DEFAULT_RESULT_LIMIT, 1, MAX_RESULT_LIMIT);
    if (target.reference) return this.inspectSymbol(target.reference, maxCharacters);
    if (!navigationFilePathSchema.safeParse(target.filePath).success) throw new GraphNavigationError('invalid_input', 'Use an indexed workspace-relative file path.');
    if (!this.backend.getFile(target.filePath)) throw new GraphNavigationError('not_found', 'The file is not indexed. Check its path and indexed scope.');
    const hash = await this.sources.fingerprint(target.filePath);
    const nodes = this.backend.getNodesInFile(target.filePath).sort((a, b) => a.startLine - b.startLine || a.id.localeCompare(b.id));
    const result: GraphInspectResult = {type: 'file', filePath: target.filePath, contentHash: hash,
      symbols: nodes.slice(0, limit).map(node => toNavigationSymbol(node, this.symbols.reference(node, hash))), truncated: nodes.length > limit, coverage: NAVIGATION_COVERAGE};
    await this.sources.verifyFiles(new Map([[result.filePath, hash]]));
    result.truncated ||= result.symbols.some(symbol => symbol.metadataTruncated);
    while (!fits(result, maxCharacters) && result.symbols.length) {result.symbols.pop(); result.truncated = true;}
    requireFits(result, maxCharacters);
    return result;
  }
  private async inspectSymbol(reference: SymbolReference, maxCharacters: number): Promise<GraphInspectResult> {
    const symbol = await this.symbols.resolve(reference);
    const source = await this.backend.getCode(symbol.id);
    if (source === null) throw new GraphNavigationError('stale_reference', 'Symbol source is unavailable. Run find or explore again.');
    await this.sources.verifyFiles(new Map([[symbol.filePath, symbol.reference.contentHash]]));
    const result: GraphInspectResult = {type: 'symbol', symbol,
      source: {text: source.slice(0, maxCharacters), startLine: symbol.startLine, endLine: symbol.endLine,
        contentHash: symbol.reference.contentHash, truncated: source.length > maxCharacters},
      truncated: symbol.metadataTruncated || source.length > maxCharacters, coverage: NAVIGATION_COVERAGE};
    while (!fits(result, maxCharacters) && result.source.text.length) {
      result.source.text = result.source.text.slice(0, Math.floor(result.source.text.length / BISECTION_DIVISOR));
      result.source.truncated = result.truncated = true;
    }
    requireFits(result, maxCharacters);
    return result;
  }

}
