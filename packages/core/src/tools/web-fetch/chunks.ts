import {createHash} from 'node:crypto';
import {MAX_CHUNK_CHARACTERS, MAX_CHUNKS} from './limits.js';

const CHUNK_BOUNDARY_DIVISOR = 2;

const CHUNK_ID_HEX_CHARACTERS = 16;
const MAX_HEADING_CHARACTERS = 256;

export class ChunkLimitError extends Error {}

export interface ContentChunk {
  id: string;
  sourceUrl: string;
  position: number;
  start: number;
  end: number;
  sectionPath: string[];
  headingPositions: number[];
  codeBlock?: number;
  text: string;
}

/** Lossless slices, with paragraph/fence boundaries preferred and heading ancestry retained. */
export function chunkContent(content: string, sourceUrl: string): ContentChunk[] {
  const chunks: ContentChunk[] = [];
  const headings: {level: number; title: string; position: number}[] = [];
  let start = 0;
  let cursor = 0;
  let fence: string | undefined;
  let codeBlock: number | undefined;
  let sectionPath: string[] = [];
  let headingPositions: number[] = [];
  const flush = (end: number) => {
    while (start < end) {
      if (chunks.length >= MAX_CHUNKS) throw new ChunkLimitError('Document exceeds the chunking limit.');
      let next = Math.min(end, start + MAX_CHUNK_CHARACTERS);
      if (next < end) {
        const line = content.lastIndexOf('\n', next - 1);
        const space = content.lastIndexOf(' ', next - 1);
        const boundary = Math.max(line, space);
        if (boundary > start + MAX_CHUNK_CHARACTERS / CHUNK_BOUNDARY_DIVISOR) next = boundary + 1;
        if (/[\uD800-\uDBFF]/.test(content[next - 1]) && /[\uDC00-\uDFFF]/.test(content[next])) next--;
      }
      const text = content.slice(start, next);
      chunks.push({id: createHash('sha256').update(`${sourceUrl}\0${start}\0${text}`).digest('hex').slice(0, CHUNK_ID_HEX_CHARACTERS),
        sourceUrl, position: chunks.length, start, end: next, sectionPath: [...sectionPath], headingPositions: [...headingPositions],
        ...(codeBlock === undefined ? {} : {codeBlock}), text});
      start = next;
    }
  };
  for (const match of content.matchAll(/[^\n]*\n|[^\n]+$/g)) {
    const line = match[0];
    const heading = (fence === undefined || fence === '') && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trimEnd());
    if (heading !== false && heading !== null) {
      flush(cursor);
      const level = heading[1].length;
      while (headings.length && headings.at(-1)!.level >= level) headings.pop();
      headings.push({level, title: heading[2].slice(0, MAX_HEADING_CHARACTERS), position: chunks.length});
      sectionPath = headings.map(entry => entry.title);
      headingPositions = headings.map(entry => entry.position);
    }
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    let closesFence = false;
    if ((marker !== undefined && marker !== '') && (fence === undefined || fence === '')) { flush(cursor); fence = marker; codeBlock = chunks.length; }
    else if ((marker !== undefined && marker !== '') && (fence !== undefined && fence !== '') && marker[0] === fence[0] && marker.length >= fence.length && /^ {0,3}(?:`+|~+)\s*$/.test(line)) closesFence = true;
    cursor += line.length;
    if ((fence === undefined || fence === '') && !line.trim() && cursor - start >= MAX_CHUNK_CHARACTERS / CHUNK_BOUNDARY_DIVISOR) flush(cursor);
    // Avoid unbounded individual sections even when a document has no blank lines.
    if (cursor - start >= MAX_CHUNK_CHARACTERS) flush(cursor);
    if (closesFence) { flush(cursor); fence = undefined; codeBlock = undefined; }
  }
  flush(content.length);
  return chunks;
}
