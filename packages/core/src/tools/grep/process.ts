import {runRipgrepRecords, RipgrepError} from '../workspace/ripgrep.js';
import {GrepError} from './errors.js';
import {parseMatch} from './matches.js';
import type {GrepSearchResult, GrepMatch} from './types.js';

function parseRecord(text: string): {record: GrepMatch} | null | {unsupported: true} {
  const match = parseMatch(text);
  if (match === 'unsupported') return {unsupported: true as const};
  return match === null ? null : {record: match};
}

export async function runRipgrep(root: string, args: string[], limit: number, signal: AbortSignal): Promise<GrepSearchResult> {
  try {
    const result = await runRipgrepRecords({root, args, limit, signal, separator: '\n', parseRecord});
    const warnings: string[] = [];
    if (result.incomplete && !result.truncated) warnings.push('Some matches could not be decoded as UTF-8 text with portable relative paths.');
    if (result.truncated) warnings.push('Search reached a result or output budget; narrow the path or pattern.');
    return {matches: result.records, truncated: result.truncated, incomplete: result.incomplete, warnings};
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof RipgrepError) throw new GrepError(error.code, error.code === 'invalid_input'
      ? 'Provide a valid ripgrep regex and include glob; PCRE2 is not supported.' : error.message);
    throw error;
  }
}
