import type {GraphFindResult} from '@codeyantram/graph';
import {evaluateSymbols} from './evaluation.js';
import type {NavigationEvaluationOptions} from './types.js';

export async function rankFindContext(context: GraphFindResult, options: NavigationEvaluationOptions & {
  query: string; filter?: boolean; signal?: AbortSignal;
}) {
  const result = await evaluateSymbols(context.matches.map(match => match.symbol), {...options, mode: 'rank'});
  const ranked = context.matches.filter(match => result.judgments.has(match.symbol.id))
    .sort((first, second) => (result.judgments.get(second.symbol.id) ?? 0) - (result.judgments.get(first.symbol.id) ?? 0));
  let next = 0;
  const matches = context.matches.map(match => result.judgments.has(match.symbol.id) ? ranked[next++] ?? match : match);
  return {context: {...context, matches}, filtering: result.filtering, warnings: result.warnings};
}
