import type * as CodegraphModule from '@colbymchenry/codegraph';
import {mkdir, stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import type {CodeGraph} from '@colbymchenry/codegraph';
import type {GraphStoragePaths} from '../contracts/storage.js';
import {resolveGraphStoragePaths} from '../storage/paths.js';
import type {WorkspaceBackend} from './ports.js';

type SDK = typeof CodegraphModule;
type EmbeddedSDK = Omit<SDK, 'CodeGraph'> & {
  CodeGraph: SDK['CodeGraph'] & {
    // The tracked install-time extension; no private fields or runtime overrides.
    connect(root: string, databasePath: string, options: {create: boolean}): Promise<CodeGraph>;
  };
};

function loadSDK(): EmbeddedSDK {
  // The npm shim is CommonJS and exposes an object, not the class as an ESM
  // default export. Keep this detail inside the adapter and load it on demand.
  const sdk = createRequire(import.meta.url)('@colbymchenry/codegraph') as EmbeddedSDK;
  if (typeof sdk.CodeGraph.connect !== 'function') {
    throw new Error('CodeGraph external storage is unavailable. Run npm install to apply the Codeyantram storage extension.');
  }
  return sdk;
}

/** Owns SDK loading and locked database creation/opening. */
export async function connectWorkspace(workspaceRoot: string): Promise<{
  storage: Readonly<GraphStoragePaths>; created: boolean; backend: WorkspaceBackend;
}> {
  const storage = await resolveGraphStoragePaths(workspaceRoot);
  const sdk = loadSDK();
  await mkdir(storage.directory, {recursive: true, mode: 0o700});
  // Schema creation/opening must not race another process's initialization or
  // indexing. The SDK uses this same global lock for indexAll and sync.
  const lock = new sdk.FileLock(storage.lockPath);
  lock.acquire();
  try {
    let created = false;
    try {
      if (!(await stat(storage.databasePath)).isFile()) throw new Error('The graph database path must be a file.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      created = true;
    }
    const backend = await sdk.CodeGraph.connect(storage.workspaceRoot, storage.databasePath, {create: created});
    return {storage: Object.freeze(storage), created, backend};
  } finally {
    lock.release();
  }
}
