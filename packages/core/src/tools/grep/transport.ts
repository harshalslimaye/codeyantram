import {resolve} from 'node:path';
import {searchLocation} from './paths.js';
import {runRipgrep} from './process.js';
import {DEFAULT_MATCH_LIMIT} from './limits.js';
import type {GrepTransport} from './types.js';

export function createGrepTransport(workspaceRoot: string): GrepTransport {
  const workspace = resolve(workspaceRoot);
  return {async search(input, signal) {
    signal.throwIfAborted();
    const {root, target} = await searchLocation(workspace, input.path ?? '.');
    const args = ['--no-config', '--json', '--engine=default', '--no-follow', '--no-multiline', '--no-text',
      '--no-search-zip', '--no-ignore-parent', '--no-ignore-global', '--no-require-git', '--threads=1', '--sort=path', '--color=never', '--max-filesize=1048576'];
    if (input.fixedStrings === true) args.push('--fixed-strings');
    if (input.ignoreCase === true) args.push('--ignore-case');
    else args.push('--case-sensitive');
    if (input.include !== undefined) args.push(`--glob=${input.include}`);
    args.push('--', input.pattern, target);
    return runRipgrep(root, args, input.limit ?? DEFAULT_MATCH_LIMIT, signal);
  }};
}
