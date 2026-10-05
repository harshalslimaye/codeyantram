import {createHash} from 'node:crypto';
import {readFile, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {navigationFilePathSchema} from '@codeyantram/shared';
import type {GraphStoragePaths} from '../contracts/storage.js';
import type {SourceBackend} from '../sdk/ports.js';
import type {SourceFingerprints} from './ports.js';
import {GraphNavigationError} from './errors.js';

/** Verifies indexed source content and workspace containment around reads. */
export class SourceVerifier implements SourceFingerprints {
  constructor(private readonly backend: SourceBackend, private readonly storage: Readonly<GraphStoragePaths>) {}

  async fingerprint(filePath: string): Promise<string> {
    if (!navigationFilePathSchema.safeParse(filePath).success) throw new GraphNavigationError('invalid_input', 'Use an indexed workspace-relative path.');
    const record = this.backend.getFile(filePath);
    if (!record) throw new GraphNavigationError('stale_reference', 'The indexed file changed. Run find or explore again.');
    try {
      const absolute = await realpath(path.resolve(this.storage.workspaceRoot, filePath));
      const relative = path.relative(this.storage.workspaceRoot, absolute);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new GraphNavigationError('invalid_input', 'The indexed source must remain inside the workspace.');
      }
      if ((await stat(absolute)).size > 1024 * 1024) throw new GraphNavigationError('source_too_large', 'Navigation source exceeds the 1 MB file limit.');
      const contents = await readFile(absolute);
      if (contents.length > 1024 * 1024) throw new GraphNavigationError('source_too_large', 'Navigation source exceeds the 1 MB file limit.');
      const hash = createHash('sha256').update(contents).digest('hex');
      if (hash !== record.contentHash) throw new GraphNavigationError('stale_reference', 'Source differs from the index. Run find or explore again.');
      return hash;
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        throw new GraphNavigationError('stale_reference', 'Source was removed or moved. Run find or explore again.');
      }
      throw error;
    }
  }

  async verifyFiles(hashes: ReadonlyMap<string, string>) {
    for (const [file, hash] of hashes) if (await this.fingerprint(file) !== hash) {
      throw new GraphNavigationError('stale_reference', 'Source changed during navigation. Run find or explore again.');
    }
  }
}
