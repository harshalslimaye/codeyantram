import {realpath} from 'node:fs/promises';
import {isAbsolute, relative, resolve, sep} from 'node:path';

export class WorkspacePathError extends Error {
  constructor(readonly code: 'permission_denied' | 'not_found' | 'execution_failed', message: string) {
    super(message);
    this.name = 'WorkspacePathError';
  }
}

export async function resolveWorkspaceLocation(workspaceRoot: string, path: string) {
  try {
    const root = await realpath(workspaceRoot);
    const target = await realpath(resolve(root, path));
    const fromRoot = containedPath(root, target);
    return {root, target: fromRoot === '' ? '.' : `.${sep}${fromRoot}`};
  } catch (error) {
    throw mapPathError(error);
  }
}

function containedPath(root: string, target: string) {
  const fromRoot = relative(root, target);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new WorkspacePathError('permission_denied', 'The operation is restricted to the host workspace.');
  }
  return fromRoot;
}

function mapPathError(error: unknown): WorkspacePathError {
  if (error instanceof WorkspacePathError) return error;
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT' || code === 'ENOTDIR') return new WorkspacePathError('not_found', 'The workspace path was not found.');
  if (code === 'EACCES' || code === 'EPERM') return new WorkspacePathError('permission_denied', 'The workspace path cannot be accessed.');
  return new WorkspacePathError('execution_failed', 'The workspace path could not be resolved safely.');
}
