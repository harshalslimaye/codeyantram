import {constants} from 'node:fs';
import {open, realpath, stat, type FileHandle} from 'node:fs/promises';
import {isAbsolute, relative, resolve, sep} from 'node:path';
import {createHash} from 'node:crypto';
import {ReadError, mapReadError} from './errors.js';
import {MAX_FILE_BYTES} from './limits.js';

function assertInside(root: string, path: string) {
  const pathFromRoot = relative(root, path);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new ReadError('permission_denied', 'Read is restricted to the host workspace.');
  }
}

export async function readWorkspaceFile(workspaceRoot: string, filePath: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  try {
    const root = await realpath(workspaceRoot);
    const path = await realpath(resolve(root, filePath));
    assertInside(root, path);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      return await readOpenedFile(handle, root, path, signal);
    } finally {await handle.close();}
  } catch (error) {
    signal?.throwIfAborted();
    throw mapReadError(error);
  }
}

async function readOpenedFile(handle: FileHandle, root: string, path: string, signal?: AbortSignal) {
  const before = await handle.stat();
  if (!before.isFile()) throw new ReadError('unsupported_content', 'Read supports regular UTF-8 text files only.');
  if (before.size > MAX_FILE_BYTES) throw new ReadError('source_too_large', 'The file exceeds the 1 MiB read limit.');
  assertInside(root, await realpath(path));
  const current = await stat(path);
  if (current.dev !== before.dev || current.ino !== before.ino) throw new ReadError('execution_failed', 'The file changed while opening it. Retry read.');
  const bytes = await readBytes(handle, signal);
  const after = await handle.stat();
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
    throw new ReadError('execution_failed', 'The file changed while reading it. Retry read.');
  }
  return {text: decodeText(bytes), contentHash: createHash('sha256').update(bytes).digest('hex')};
}

async function readBytes(handle: FileHandle, signal?: AbortSignal) {
  const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
  let length = 0;
  while (length < buffer.length) {
    signal?.throwIfAborted();
    const {bytesRead} = await handle.read(buffer, length, buffer.length - length, length);
    if (bytesRead === 0) break;
    length += bytesRead;
  }
  signal?.throwIfAborted();
  if (length > MAX_FILE_BYTES) throw new ReadError('source_too_large', 'The file exceeds the 1 MiB read limit.');
  return buffer.subarray(0, length);
}

function decodeText(bytes: Buffer): string {
  if (bytes.includes(0)) throw new ReadError('unsupported_content', 'Binary files are not supported by read.');
  try {return new TextDecoder('utf-8', {fatal: true}).decode(bytes);}
  catch {throw new ReadError('unsupported_content', 'Read requires valid UTF-8 text.');}
}
