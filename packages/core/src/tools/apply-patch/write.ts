import {randomUUID} from 'node:crypto';
import {link, open, rename, unlink} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {ApplyPatchError, mapPatchError} from './errors.js';
import {verifyChange, type PlannedChange} from './plan.js';
import type {ApplyPatchOutput} from './types.js';

const DEFAULT_FILE_MODE = 0o644;

export async function commitPatch(root: string, plan: PlannedChange[], signal?: AbortSignal) {
  const staged = new Map<PlannedChange, string>();
  const applied: ApplyPatchOutput['applied'] = [];
  try {
    for (const item of plan) {
      signal?.throwIfAborted();
      if (item.after !== null) await stageChange(item, staged);
    }
    for (const item of plan) await verifyChange(root, item, signal);
    for (const item of plan) {
      signal?.throwIfAborted();
      await verifyChange(root, item, signal);
      await writeChange(item, staged.get(item));
      applied.push({filePath: item.change.filePath, action: item.change.action, contentHash: item.afterHash});
    }
    return applied;
  } catch (error) {
    if (applied.length > 0) throw new ApplyPatchError('execution_failed', `Patch partially applied to ${applied.map(item => item.filePath).join(', ')}. Re-read all targets; do not replay the original patch.`);
    throw mapPatchError(error);
  } finally {
    for (const path of staged.values()) await unlink(path).catch((error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw mapPatchError(error);
    });
  }
}

async function stageChange(item: PlannedChange, staged: Map<PlannedChange, string>) {
  const temporary = join(dirname(item.target), `.codeyantram-patch-${randomUUID()}`);
  const handle = await open(temporary, 'wx', DEFAULT_FILE_MODE);
  staged.set(item, temporary);
  try {
    await handle.writeFile(item.after ?? '', 'utf8');
    await handle.chmod(item.before?.mode ?? DEFAULT_FILE_MODE);
    await handle.sync();
  } finally {await handle.close();}
}

async function writeChange(item: PlannedChange, staged: string | undefined) {
  if (item.change.action === 'delete') {await unlink(item.target); return;}
  if (staged === undefined) throw new ApplyPatchError('execution_failed', 'The staged patch file was unavailable.');
  if (item.change.action === 'add') await link(staged, item.target);
  else await rename(staged, item.target);
}
