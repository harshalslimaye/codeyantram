import {resolve, sep} from 'node:path';
import {navigationFilePathSchema} from '@codeyantram/shared';
import {WorkspacePathError} from '../workspace/paths.js';
import {runRipgrepRecords, RipgrepError} from '../workspace/ripgrep.js';
import {GlobError} from './errors.js';
import {DEFAULT_FILE_LIMIT} from './limits.js';
import {discoveryLocation} from './paths.js';
import type {GlobTransport} from './types.js';

function parseFile(record: string, hidden: boolean): {record: string} | {unsupported: true} | null {
  const portable = sep === '\\' ? record.replaceAll('\\', '/') : record;
  const filePath = portable.replace(/^\.\//, '');
  if (!navigationFilePathSchema.safeParse(filePath).success) return {unsupported: true};
  const segments = filePath.split('/');
  if (segments.includes('.git')) return null;
  if (!hidden && segments.some(segment => segment.startsWith('.'))) return null;
  return {record: filePath};
}

export function createGlobTransport(workspaceRoot: string): GlobTransport {
  const workspace = resolve(workspaceRoot);
  return {async discover(input, signal) {
    signal.throwIfAborted();
    try {
      const {root, target} = await discoveryLocation(workspace, input.path ?? '.');
      const args = ['--no-config', '--files', '--null', '--no-follow', '--no-ignore-parent', '--no-ignore-global',
        '--no-require-git', '--threads=1', '--sort=path', '--color=never', `--glob=${input.pattern}`, '--glob=!.git/**'];
      if (input.ignoreCase === true) args.push('--glob-case-insensitive');
      if (input.hidden === true) args.push('--hidden');
      else args.push('--glob=!**/.*', '--glob=!**/.*/**');
      args.push('--', target);
      const result = await runRipgrepRecords({root, args, limit: input.limit ?? DEFAULT_FILE_LIMIT, signal, separator: '\0',
        parseRecord: record => parseFile(record, input.hidden === true)});
      const warnings: string[] = [];
      if (result.incomplete && !result.truncated) warnings.push('Some discovered paths could not be represented as portable workspace-relative paths.');
      if (result.truncated) warnings.push('File discovery reached a result or output budget; narrow the path or pattern.');
      return {files: result.records, truncated: result.truncated, incomplete: result.incomplete, warnings};
    } catch (error) {
      signal.throwIfAborted();
      throw mapTransportError(error);
    }
  }};
}

function mapTransportError(error: unknown): GlobError {
  if (error instanceof GlobError) return error;
  if (error instanceof WorkspacePathError) return new GlobError(error.code, error.message);
  if (error instanceof RipgrepError) return new GlobError(error.code, error.code === 'invalid_input' ? 'Provide a valid ripgrep glob pattern.' : error.message);
  return new GlobError('execution_failed', 'Workspace file discovery could not complete safely.');
}
