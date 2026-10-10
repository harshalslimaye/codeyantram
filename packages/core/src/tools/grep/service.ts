import type {JevCapability} from '../../evaluation/index.js';
import {abortable, deadline} from '../../evaluation/cancellation.js';
import {GrepError} from './errors.js';
import {SEARCH_TIMEOUT_MS} from './limits.js';
import {grepInputSchema} from './schema.js';
import {rankGrepMatches} from './selection.js';
import {createGrepTransport} from './transport.js';
import type {GrepService, GrepTransport} from './types.js';

export function createGrepService(options: {workspaceRoot: string; jev?: JevCapability; transport?: GrepTransport}): GrepService {
  if (!options.workspaceRoot.trim()) throw new GrepError('invalid_input', 'The host must provide a workspace root.');
  const transport = options.transport ?? createGrepTransport(options.workspaceRoot);
  const jev = options.jev;
  return {async search(input, context = {}) {
    context.abortSignal?.throwIfAborted();
    const parsed = grepInputSchema.safeParse(input);
    if (!parsed.success) throw new GrepError('invalid_input', 'Provide a search pattern, workspace-relative path, and valid search options.');
    const args = parsed.data;
    const scope = deadline(SEARCH_TIMEOUT_MS, context.abortSignal, {
      timeout: () => new GrepError('timeout', 'Workspace search timed out. Narrow the path or pattern.'),
      cancelled: () => new GrepError('execution_failed', 'Workspace search cancelled.'),
    });
    const found = await (async () => {
      try {return await abortable(transport.search(args, scope.signal), scope.signal);}
      catch (error) {context.abortSignal?.throwIfAborted(); throw error;}
      finally {scope.dispose();}
    })();
    const ranked = await rankGrepMatches(found.matches, {jev, objective: args.query ?? context.objective,
      pattern: args.pattern, filter: args.filter, signal: context.abortSignal});
    return {pattern: args.pattern, path: args.path ?? '.', matches: ranked.matches,
      truncated: found.truncated, incomplete: found.incomplete,
      coverage: 'Text search only: ripgrep ignore rules and hidden-file defaults apply to directory searches; symlinks are not traversed, binary/non-UTF-8 content may be skipped, and files over 1 MiB are excluded. Empty results do not prove absence.',
      untrusted: true, filtering: ranked.filtering, warnings: [...found.warnings, ...ranked.warnings]};
  }};
}
