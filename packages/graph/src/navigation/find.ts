import type {GraphFindResult, GraphFindOptions} from '../contracts/navigation.js';
import type {FindBackend} from '../sdk/ports.js';
import type {SourceFingerprints, VerifiedSymbols} from './ports.js';
import {budget, fits, integer, requireFits} from './budget.js';
import {NAVIGATION_COVERAGE} from './coverage.js';
import {GraphNavigationError} from './errors.js';

const MAX_QUERY_CHARACTERS = 1024;
const DEFAULT_RESULT_LIMIT = 20;
const MAX_RESULT_LIMIT = 50;

export class FindQuery {
  constructor(private readonly backend: FindBackend, private readonly sources: SourceFingerprints,
    private readonly symbols: VerifiedSymbols) {}

  async execute(query: string, options: GraphFindOptions = {}): Promise<GraphFindResult> {
    if (!query.trim() || query.length > MAX_QUERY_CHARACTERS) throw new GraphNavigationError('invalid_input', 'Find requires between 1 and 1024 characters.');
    const limit = integer(options.limit ?? DEFAULT_RESULT_LIMIT, 1, MAX_RESULT_LIMIT), maxCharacters = budget(options.maxCharacters);
    const candidates = this.backend.searchNodes(query, {limit: limit + 1});
    const result: GraphFindResult = {query, matches: [], truncated: candidates.length > limit, coverage: NAVIGATION_COVERAGE};
    const hashes = new Map<string, string>();
    await this.collectMatches(candidates.slice(0, limit), result, hashes);
    await this.sources.verifyFiles(hashes);
    result.truncated ||= result.matches.some(match => match.symbol.metadataTruncated);
    while (!fits(result, maxCharacters) && result.matches.length) {result.matches.pop(); result.truncated = true;}
    requireFits(result, maxCharacters);
    return result;
  }
  private async collectMatches(candidates: ReturnType<FindBackend['searchNodes']>, result: GraphFindResult, hashes: Map<string, string>) {
    for (const candidate of candidates) {
      try {result.matches.push({symbol: await this.symbols.verified(candidate.node, hashes), score: candidate.score});}
      catch (error) {
        if (!(error instanceof GraphNavigationError) || error.code !== 'source_too_large') throw error;
        result.truncated = true;
      }
    }
  }

}
