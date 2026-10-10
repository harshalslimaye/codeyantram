import {MAX_CHUNK_CHARACTERS, MAX_CHUNK_LINES} from './limits.js';
import type {ReadLine, ReadRange} from './types.js';

export interface ReadChunk extends ReadRange {id: string}

export function chunkLines(lines: ReadLine[]): ReadChunk[] {
  const chunks: ReadChunk[] = [];
  let pending: ReadLine[] = [];
  let characters = 0;
  const flush = () => {
    const first = pending.at(0);
    const last = pending.at(-1);
    if (first && last) chunks.push({id: `lines-${first.number}-${last.number}`, startLine: first.number, endLine: last.number, text: pending.map(line => line.text).join('\n')});
    pending = [];
    characters = 0;
  };
  for (const line of lines) {
    if (pending.length >= MAX_CHUNK_LINES || characters + line.text.length > MAX_CHUNK_CHARACTERS) flush();
    pending.push(line);
    characters += line.text.length + 1;
  }
  flush();
  return chunks;
}
