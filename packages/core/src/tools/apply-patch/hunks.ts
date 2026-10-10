import {ApplyPatchError} from './errors.js';
import {invalidPatch} from './parser.js';

interface Hunk {anchor?: string; before: string[]; after: string[]; eof: boolean}

function parseHunks(lines: string[]): Hunk[] {
  const hunks: Hunk[] = [];
  for (const line of lines) {
    if (line === '@@' || line.startsWith('@@ ')) {
      hunks.push({anchor: line === '@@' ? undefined : line.slice('@@ '.length), before: [], after: [], eof: false});
    } else appendLine(hunks.at(-1), line);
  }
  if (hunks.some(hunk => hunk.before.length === 0 || hunk.before.join('\n') === hunk.after.join('\n'))) invalidPatch();
  return hunks;
}

function appendLine(hunk: Hunk | undefined, line: string) {
  if (!hunk || hunk.eof) invalidPatch();
  if (line === '*** End of File') {hunk.eof = true; return;}
  const prefix = line[0];
  if (prefix !== ' ' && prefix !== '+' && prefix !== '-') invalidPatch();
  if (prefix !== '+') hunk.before.push(line.slice(1));
  if (prefix !== '-') hunk.after.push(line.slice(1));
}

function sourceLines(text: string) {
  const bom = text.startsWith('\ufeff') ? '\ufeff' : '';
  const content = text.slice(bom.length);
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const normalized = content.replaceAll('\r\n', '\n');
  if (normalized.includes('\r')) throw new ApplyPatchError('unsupported_content', 'Mixed or bare carriage-return line endings are not supported.');
  if (newline === '\r\n' && text.replaceAll('\r\n', '').includes('\n')) {
    throw new ApplyPatchError('unsupported_content', 'Mixed line endings are not supported.');
  }
  const trailing = normalized.endsWith('\n');
  const source = normalized === '' ? [] : normalized.split('\n');
  if (trailing) source.pop();
  return {bom, newline, trailing, source};
}

export function applyHunks(text: string, patch: string[]): string {
  const {bom, newline, trailing, source} = sourceLines(text);
  let cursor = 0;
  let result: string[] = [];
  for (const hunk of parseHunks(patch)) {
    const position = locateHunk(source, hunk, cursor);
    result = result.concat(source.slice(cursor, position), hunk.after);
    cursor = position + hunk.before.length;
  }
  result = result.concat(source.slice(cursor));
  const suffix = trailing && result.length > 0 ? newline : '';
  return bom + result.join(newline) + suffix;
}

function locateHunk(source: string[], hunk: Hunk, cursor: number) {
  let start = cursor;
  if (hunk.anchor !== undefined) {
    const anchors = source.flatMap((line, position) => position >= cursor && line === hunk.anchor ? [position] : []);
    if (anchors.length !== 1) mismatch();
    start = (anchors[0] ?? cursor) + 1;
  }
  if (source.length - start < hunk.before.length) mismatch();
  const haystack = `\n${source.slice(start).join('\n')}\n`;
  const needle = `\n${hunk.before.join('\n')}\n`;
  const match = uniqueMatch(haystack, needle, hunk.eof);
  return start + haystack.slice(0, match).split('\n').length - 1;
}

function uniqueMatch(haystack: string, needle: string, eof: boolean) {
  const match = eof ? haystack.lastIndexOf(needle) : haystack.indexOf(needle);
  if (match < 0 || eof && match + needle.length !== haystack.length) mismatch();
  if (!eof && haystack.indexOf(needle, match + 1) !== -1) mismatch();
  return match;
}

function mismatch(): never {
  throw new ApplyPatchError('stale_reference', 'Patch context is missing or ambiguous. Re-read the complete file and supply unique exact context.');
}
