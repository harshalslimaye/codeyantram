import {constants, type Stats} from 'node:fs';
import {lstat, open, realpath, type FileHandle} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {ApplyPatchError} from './errors.js';
import {MAX_FILE_BYTES} from './limits.js';

const PERMISSION_MASK = 0o777;

export interface PatchSnapshot {
  text: string;
  hash: string;
  mode: number;
  inode: number;
  device: number;
}

export function hashText(text: string) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function patchTarget(root: string, filePath: string) {
  if (await realpath(root) !== root) throw new ApplyPatchError('permission_denied', 'The workspace root changed.');
  let parent = root;
  const segments = filePath.split('/');
  for (const segment of segments.slice(0, -1)) {
    parent = join(parent, segment);
    const entry = await lstat(parent);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new ApplyPatchError('permission_denied', 'Patch parents must be existing directories, never symlinks.');
  }
  return join(root, ...segments);
}

export async function snapshotFile(path: string, signal?: AbortSignal): Promise<PatchSnapshot | null> {
  signal?.throwIfAborted();
  const entry = await lstat(path).catch(missingFile);
  if (!entry) return null;
  if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) {
    throw new ApplyPatchError('permission_denied', 'Patch targets must be regular files without symlinks or hard links.');
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (before.ino !== entry.ino || before.dev !== entry.dev) changed();
    const text = await readText(handle, signal);
    const after = await handle.stat();
    const current = await lstat(path);
    verifySnapshot(before, after, current);
    return {text, hash: hashText(text), mode: before.mode & PERMISSION_MASK, inode: before.ino, device: before.dev};
  } finally {await handle.close();}
}

function missingFile(error: unknown): null {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
  throw error;
}

function verifySnapshot(before: Stats, after: Stats, current: Stats) {
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) changed();
  if (current.ino !== after.ino || current.dev !== after.dev || current.nlink !== 1) changed();
}

async function readText(handle: FileHandle, signal?: AbortSignal) {
  const info = await handle.stat();
  if (info.size > MAX_FILE_BYTES) throw new ApplyPatchError('source_too_large', 'Patch targets are limited to 1 MiB.');
  const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
  let length = 0;
  while (length < buffer.length) {
    signal?.throwIfAborted();
    const {bytesRead} = await handle.read(buffer, length, buffer.length - length, length);
    if (bytesRead === 0) break;
    length += bytesRead;
  }
  if (length > MAX_FILE_BYTES) throw new ApplyPatchError('source_too_large', 'Patch targets are limited to 1 MiB.');
  const bytes = buffer.subarray(0, length);
  if (bytes.includes(0)) throw new ApplyPatchError('unsupported_content', 'Patches support UTF-8 text only.');
  try {return new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);}
  catch {throw new ApplyPatchError('unsupported_content', 'Patches require valid UTF-8 text.');}
}

export function changed(): never {
  throw new ApplyPatchError('stale_reference', 'A patch target changed. Re-read every target and obtain approval again.');
}
