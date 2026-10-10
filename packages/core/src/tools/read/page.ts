import {DEFAULT_READ_LINES, MAX_READ_CHARACTERS, MAX_PAGE_BYTES} from './limits.js';
import type {ReadInput} from './schema.js';
import type {ReadLine} from './types.js';

const SHRINK_DIVISOR = 2;

function sliceText(text: string, length: number) {
  const sliced = text.slice(0, length);
  return /[\uD800-\uDBFF]$/.test(sliced) ? sliced.slice(0, -1) : sliced;
}

function fitLine(text: string, number: number, characters: number, bytes: number): ReadLine {
  let selected = sliceText(text, characters);
  while (Buffer.byteLength(JSON.stringify({number, text: selected, truncated: true}), 'utf8') > bytes) {
    selected = sliceText(selected, Math.floor(selected.length / SHRINK_DIVISOR));
    if (selected === '') break;
  }
  return {number, text: selected, truncated: selected.length < text.length};
}

function collectLines(allLines: string[], input: ReadInput): ReadLine[] {
  const offset = input.offset ?? 1;
  const end = Math.min(allLines.length, offset - 1 + (input.limit ?? DEFAULT_READ_LINES));
  let remainingCharacters = input.maxCharacters ?? MAX_READ_CHARACTERS;
  let remainingBytes = MAX_PAGE_BYTES;
  const lines: ReadLine[] = [];
  for (let position = offset - 1; position < end && remainingCharacters > 0; position++) {
    const line = fitLine(allLines.at(position) ?? '', position + 1, remainingCharacters, remainingBytes);
    const bytes = Buffer.byteLength(JSON.stringify(line), 'utf8');
    if (bytes > remainingBytes) break;
    lines.push(line);
    remainingCharacters -= line.text.length + 1;
    remainingBytes -= bytes;
  }
  return lines;
}

export function readPage(text: string, input: ReadInput) {
  const allLines = text === '' ? [] : text.split(/\r?\n/);
  if (text.endsWith('\n')) allLines.pop();
  const offset = input.offset ?? 1;
  const lines = collectLines(allLines, input);
  const last = lines.at(-1)?.number ?? offset - 1;
  const nextOffset = last < allLines.length ? last + 1 : null;
  const lineTruncated = lines.some(line => line.truncated);
  return {lines, totalLines: allLines.length, offset, nextOffset,
    truncation: {truncated: offset > 1 || nextOffset !== null || lineTruncated, lineTruncated},
  };
}
