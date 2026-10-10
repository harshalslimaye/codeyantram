import {navigationFilePathSchema} from '@codeyantram/shared';
import {ApplyPatchError} from './errors.js';
import {MAX_PATCH_FILES} from './limits.js';
import type {PatchChange} from './types.js';

export function invalidPatch(): never {
  throw new ApplyPatchError('invalid_input', 'Use Begin/End Patch with Add, Update, or Delete File sections and exact-context hunks. Moves and unified diffs are not supported.');
}

export function parsePatch(text: string): PatchChange[] {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.shift() !== '*** Begin Patch' || lines.pop() !== '*** End Patch') invalidPatch();
  const changes: PatchChange[] = [];
  for (const line of lines) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (header) changes.push(parseHeader(header));
    else appendBody(changes.at(-1), line);
  }
  if (changes.length === 0 || changes.length > MAX_PATCH_FILES) invalidPatch();
  const paths = changes.map(change => change.filePath.toLowerCase());
  if (new Set(paths).size !== paths.length) invalidPatch();
  for (const change of changes) validateBody(change);
  return changes;
}

function appendBody(current: PatchChange | undefined, line: string) {
  if (!current || line.startsWith('*** ') && line !== '*** End of File') invalidPatch();
  current.lines.push(line);
}

function parseHeader(header: RegExpExecArray): PatchChange {
  const filePath = navigationFilePathSchema.safeParse(header[2]);
  if (!filePath.success || /[\r\n]/.test(filePath.data)) invalidPatch();
  const protectedNames = new Set(['.git', '.agents', '.codex', '.aws']);
  if (filePath.data.split('/').some(segment => protectedNames.has(segment.toLowerCase()))) {
    throw new ApplyPatchError('permission_denied', 'Patches cannot modify protected workspace metadata.');
  }
  const action = header[1]?.toLowerCase();
  if (action !== 'add' && action !== 'update' && action !== 'delete') invalidPatch();
  return {filePath: filePath.data, action, lines: []};
}

function validateBody(change: PatchChange) {
  if (change.action === 'delete' && change.lines.length !== 0) invalidPatch();
  if (change.action === 'add' && change.lines.some(line => !line.startsWith('+'))) invalidPatch();
  if (change.action === 'update' && !change.lines[0]?.startsWith('@@')) invalidPatch();
}
