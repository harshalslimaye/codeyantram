import {stat} from 'node:fs/promises';
import {resolve, relative, sep} from 'node:path';
import {navigationFilePathSchema} from '@codeyantram/shared';
import {resolveWorkspaceLocation} from '../workspace/paths.js';
import {BashError} from './errors.js';

export async function commandDirectory(workspaceRoot: string, requestedWorkdir: string) {
  const location = await resolveWorkspaceLocation(workspaceRoot, requestedWorkdir);
  const cwd = resolve(location.root, location.target);
  if (!(await stat(cwd)).isDirectory()) throw new BashError('invalid_input', 'Command workdir must be an existing workspace directory.');
  const workdir = relative(location.root, cwd).split(sep).join('/') || '.';
  if (workdir !== '.' && !navigationFilePathSchema.safeParse(workdir).success) {
    throw new BashError('invalid_input', 'The canonical command directory must be a portable workspace-relative path.');
  }
  return {root: location.root, cwd, workdir};
}
