import type {GraphExploreContext} from '@codeyantram/graph';
import {retainUncertainEvidence} from '../../evaluation/index.js';
import {evaluateSymbols} from './evaluation.js';
import type {NavigationEvaluationOptions} from './types.js';

const IRRELEVANT_PROBABILITY = 0.05;

export async function selectExploreContext(context: GraphExploreContext, options: NavigationEvaluationOptions & {
  query: string; filter?: boolean; signal?: AbortSignal;
}) {
  const result = await evaluateSymbols(context.symbols, {...options, mode: 'filter', context});
  if (result.judgments.size === 0) return {context, filtering: result.filtering, warnings: result.warnings};
  const retained = new Set(context.symbols.filter(symbol => retainUncertainEvidence(result.judgments.get(symbol.id), IRRELEVANT_PROBABILITY)).map(symbol => symbol.id));
  if (retained.size === 0) return {context, filtering: {...result.filtering, reason: 'no_evidence'},
    warnings: [...result.warnings, 'JEV selected no evidence; original graph results returned.']};
  retainConnectedSymbols(context, retained);
  if (retained.size === context.symbols.length) return {context, filtering: result.filtering, warnings: result.warnings};
  const symbols = context.symbols.filter(symbol => retained.has(symbol.id));
  return {
    context: {...context, summary: '', symbols,
      snippets: context.snippets.filter(snippet => retained.has(snippet.symbolId)),
      relationships: context.relationships.filter(edge => retained.has(edge.source) && retained.has(edge.target)),
      relatedFiles: [...new Set(symbols.map(symbol => symbol.filePath))],
    },
    filtering: {...result.filtering, retainedCandidates: symbols.length},
    warnings: [...result.warnings, 'JEV omitted potentially irrelevant symbols. Use filter:false to retrieve the original context.'],
  };
}

function retainConnectedSymbols(context: GraphExploreContext, retained: Set<string>) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of context.relationships) {
      if (!retained.has(edge.source) && !retained.has(edge.target)) continue;
      const previousSize = retained.size;
      retained.add(edge.source);
      retained.add(edge.target);
      if (retained.size > previousSize) changed = true;
    }
  }
}
