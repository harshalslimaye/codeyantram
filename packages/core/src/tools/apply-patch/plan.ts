import {ApplyPatchError} from './errors.js';
import {changed, hashText, patchTarget, snapshotFile, type PatchSnapshot} from './filesystem.js';
import {applyHunks} from './hunks.js';
import {MAX_FILE_BYTES} from './limits.js';
import type {ApplyPatchInput} from './schema.js';
import type {PatchChange} from './types.js';

export interface PlannedChange {
  change: PatchChange;
  target: string;
  before: PatchSnapshot | null;
  after: string | null;
  afterHash: string | null;
}

export async function preparePatch(root: string, changes: PatchChange[], input: ApplyPatchInput, signal?: AbortSignal) {
  const expected = new Map(Object.entries(input.expectedHashes));
  const required = changes.filter(change => change.action !== 'add');
  if (expected.size !== required.length || required.some(change => !expected.has(change.filePath))) {
    throw new ApplyPatchError('invalid_input', 'Supply exactly one expected SHA-256 hash for every updated or deleted file, and none for added files.');
  }
  const plan: PlannedChange[] = [];
  for (const change of changes) {
    signal?.throwIfAborted();
    const target = await patchTarget(root, change.filePath);
    const before = await snapshotFile(target, signal);
    validateSnapshot(change, before, expected);
    const after = patchedText(change, before);
    if (after !== null && Buffer.byteLength(after, 'utf8') > MAX_FILE_BYTES) {
      throw new ApplyPatchError('source_too_large', 'Patched files are limited to 1 MiB.');
    }
    plan.push({change, target, before, after, afterHash: after === null ? null : hashText(after)});
  }
  return plan;
}

function validateSnapshot(change: PatchChange, before: PatchSnapshot | null, hashes: Map<string, string>) {
  if (change.action === 'add') {
    if (before) throw new ApplyPatchError('invalid_input', 'Add File cannot overwrite an existing file.');
  } else {
    if (!before) throw new ApplyPatchError('not_found', 'An updated or deleted file was not found.');
    if (before.hash !== hashes.get(change.filePath)) changed();
  }
}

function patchedText(change: PatchChange, before: PatchSnapshot | null) {
  if (change.action === 'delete') return null;
  if (change.action === 'add') return change.lines.length === 0 ? '' : `${change.lines.map(line => line.slice(1)).join('\n')}\n`;
  return applyHunks(before?.text ?? '', change.lines);
}

export async function verifyChange(root: string, plan: PlannedChange, signal?: AbortSignal) {
  const target = await patchTarget(root, plan.change.filePath);
  if (target !== plan.target) changed();
  const current = await snapshotFile(target, signal);
  if (plan.before === null) {if (current !== null) changed(); return;}
  if (!current || current.hash !== plan.before.hash || current.inode !== plan.before.inode || current.device !== plan.before.device
    || current.mode !== plan.before.mode) changed();
}
