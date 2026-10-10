import type {JevCapability} from '../../evaluation/index.js';
import {abortable, deadline} from '../../evaluation/cancellation.js';
import {GlobError} from './errors.js';
import {DISCOVERY_TIMEOUT_MS} from './limits.js';
import {globInputSchema} from './schema.js';
import {rankGlobFiles} from './selection.js';
import {createGlobTransport} from './transport.js';
import type {GlobService, GlobTransport} from './types.js';

export function createGlobService(options: {workspaceRoot: string; jev?: JevCapability; transport?: GlobTransport}): GlobService {
  if (!options.workspaceRoot.trim()) throw new GlobError('invalid_input', 'The host must provide a workspace root.');
  const transport = options.transport ?? createGlobTransport(options.workspaceRoot);
  const jev = options.jev;
  return {async discover(input, context = {}) {
    context.abortSignal?.throwIfAborted();
    const parsed = globInputSchema.safeParse(input);
    if (!parsed.success) throw new GlobError('invalid_input', 'Provide a glob pattern, workspace-relative path, and valid discovery options.');
    const args = parsed.data;
    const scope = deadline(DISCOVERY_TIMEOUT_MS, context.abortSignal, {
      timeout: () => new GlobError('timeout', 'Workspace file discovery timed out. Narrow the path or pattern.'),
      cancelled: () => new GlobError('execution_failed', 'Workspace file discovery cancelled.'),
    });
    const found = await (async () => {
      try {return await abortable(transport.discover(args, scope.signal), scope.signal);}
      catch (error) {context.abortSignal?.throwIfAborted(); throw error;}
      finally {scope.dispose();}
    })();
    const ranked = await rankGlobFiles(found.files, {jev, objective: args.query ?? context.objective,
      pattern: args.pattern, filter: args.filter, signal: context.abortSignal});
    return {pattern: args.pattern, path: args.path ?? '.', files: ranked.files,
      truncated: found.truncated, incomplete: found.incomplete,
      coverage: 'File paths only: explicit ripgrep glob patterns can override ignore rules. Hidden files are excluded unless hidden:true; Git internals are always excluded and symlinks are not traversed. Empty results do not prove absence.',
      untrusted: true, filtering: ranked.filtering, warnings: [...found.warnings, ...ranked.warnings]};
  }};
}
