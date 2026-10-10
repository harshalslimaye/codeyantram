import {createHash} from 'node:crypto';
import {MAX_CHUNK_CHARACTERS, MAX_CHUNKS} from './limits.js';

const CHUNK_BOUNDARY_DIVISOR = 2;

const CHUNK_ID_HEX_CHARACTERS = 16;
const MAX_HEADING_CHARACTERS = 256;

import {ChunkLimitError} from './chunk-error.js';
export {ChunkLimitError} from './chunk-error.js';

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

type Heading = {level: number; title: string; position: number};

/** Lossless slices, with paragraph/fence boundaries preferred and heading ancestry retained. */
export function chunkContent(content: string, sourceUrl: string): ContentChunk[] {
  return new ChunkBuilder(content, sourceUrl).build();
}

class ChunkBuilder {
  private readonly chunks: ContentChunk[] = [];
  private readonly headings: Heading[] = [];
  private start = 0;
  private cursor = 0;
  private fence: string | undefined;
  private codeBlock: number | undefined;
  private sectionPath: string[] = [];
  private headingPositions: number[] = [];

  constructor(private readonly content: string, private readonly sourceUrl: string) {}

  build(): ContentChunk[] {
    for (const match of this.content.matchAll(/[^\n]*\n|[^\n]+$/g)) this.processLine(match[0]);
    this.flush(this.content.length);
    return this.chunks;
  }

  private processLine(line: string) {
    this.recordHeading(line);
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    const closesFence = this.updateFence(marker, line);
    this.cursor += line.length;
    if ((this.fence === undefined || this.fence === '') && !line.trim() && this.cursor - this.start >= MAX_CHUNK_CHARACTERS / CHUNK_BOUNDARY_DIVISOR) this.flush(this.cursor);
    // Avoid unbounded individual sections even when a document has no blank lines.
    if (this.cursor - this.start >= MAX_CHUNK_CHARACTERS) this.flush(this.cursor);
    if (closesFence) {this.flush(this.cursor); this.fence = undefined; this.codeBlock = undefined;}
  }

  private recordHeading(line: string) {
    const heading = (this.fence === undefined || this.fence === '') && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trimEnd());
    if (heading === false || heading === null) return;
    this.flush(this.cursor);
    const level = heading[1].length;
    for (let top = this.headings.at(-1); top !== undefined && top.level >= level; top = this.headings.at(-1)) this.headings.pop();
    this.headings.push({level, title: heading[2].slice(0, MAX_HEADING_CHARACTERS), position: this.chunks.length});
    this.sectionPath = this.headings.map(entry => entry.title);
    this.headingPositions = this.headings.map(entry => entry.position);
  }

  private updateFence(marker: string | undefined, line: string): boolean {
    if (marker === undefined || marker === '') return false;
    if (this.fence === undefined || this.fence === '') {
      this.flush(this.cursor); this.fence = marker; this.codeBlock = this.chunks.length;
      return false;
    }
    return marker[0] === this.fence[0] && marker.length >= this.fence.length && /^ {0,3}(?:`+|~+)\s*$/.test(line);
  }

  private flush(end: number) {
    while (this.start < end) {
      if (this.chunks.length >= MAX_CHUNKS) throw new ChunkLimitError('Document exceeds the chunking limit.');
      const next = nextBoundary(this.content, this.start, end);
      const text = this.content.slice(this.start, next);
      this.chunks.push({id: createHash('sha256').update(`${this.sourceUrl}\0${this.start}\0${text}`).digest('hex').slice(0, CHUNK_ID_HEX_CHARACTERS),
        sourceUrl: this.sourceUrl, position: this.chunks.length, start: this.start, end: next, sectionPath: [...this.sectionPath], headingPositions: [...this.headingPositions],
        ...(this.codeBlock === undefined ? {} : {codeBlock: this.codeBlock}), text});
      this.start = next;
    }
  }
}

function nextBoundary(content: string, start: number, end: number): number {
  let next = Math.min(end, start + MAX_CHUNK_CHARACTERS);
  if (next < end) {
    const line = content.lastIndexOf('\n', next - 1);
    const space = content.lastIndexOf(' ', next - 1);
    const boundary = Math.max(line, space);
    if (boundary > start + MAX_CHUNK_CHARACTERS / CHUNK_BOUNDARY_DIVISOR) next = boundary + 1;
    if (/[\uD800-\uDBFF]/.test(content[next - 1]) && /[\uDC00-\uDFFF]/.test(content[next])) next--; // oxlint-disable-line security/detect-object-injection -- Offsets are bounded by the current text slice before checking surrogate pairs.
  }
  return next;
}
