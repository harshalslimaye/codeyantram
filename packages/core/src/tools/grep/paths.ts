import {realpath} from 'node:fs/promises';
import {isAbsolute, relative, resolve, sep} from 'node:path';
import {GrepError, mapGrepError} from './errors.js';

export async function searchLocation(workspaceRoot: string, path: string) {
  try {
    const root = await realpath(workspaceRoot);
    const target = await realpath(resolve(root, path));
    const fromRoot = relative(root, target);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new GrepError('permission_denied', 'Grep is restricted to the host workspace.');
    }
    return {root, target: fromRoot === '' ? '.' : `.${sep}${fromRoot}`};
  } catch (error) {throw mapGrepError(error);}
}
