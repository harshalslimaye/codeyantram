import {createHash} from 'node:crypto';
import {realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {getUserGraphDirectory} from '@codeyantram/shared';
import type {GraphStoragePaths} from '../contracts/storage.js';

/** Resolves storage without creating directories or opening a database. */
export async function resolveGraphStoragePaths(workspaceRoot: string): Promise<GraphStoragePaths> {
  if (!workspaceRoot.trim()) throw new Error('A graph workspace root is required.');
  const canonicalRoot = await realpath(path.resolve(workspaceRoot));
  if (!(await stat(canonicalRoot)).isDirectory()) {
    throw new Error('The graph workspace root must be a directory.');
  }

  // Resolve symlinks so aliases share an index; separate checkouts retain separate indexes.
  const identity = process.platform === 'win32' ? canonicalRoot.toLowerCase() : canonicalRoot;
  const workspaceId = createHash('sha256').update(identity).digest('hex');
  const directory = path.join(getUserGraphDirectory(), workspaceId);
  return {
    workspaceRoot: canonicalRoot,
    workspaceId,
    directory,
    databasePath: path.join(directory, 'codegraph.db'),
    lockPath: path.join(directory, 'codegraph.lock'),
  };
}
