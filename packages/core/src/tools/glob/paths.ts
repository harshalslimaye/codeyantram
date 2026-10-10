import {stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {resolveWorkspaceLocation} from '../workspace/paths.js';
import {GlobError} from './errors.js';

export async function discoveryLocation(workspaceRoot: string, path: string) {
  const location = await resolveWorkspaceLocation(workspaceRoot, path);
  if (!(await stat(resolve(location.root, location.target))).isDirectory()) {
    throw new GlobError('invalid_input', 'Glob path must select a workspace directory, not a file.');
  }
  return location;
}
