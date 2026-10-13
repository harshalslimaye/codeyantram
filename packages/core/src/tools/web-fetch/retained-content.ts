import type {ContentChunk} from './chunks.js';
import {retainUncertainEvidence} from '../../evaluation/index.js';
import {DEFAULT_JEV_RETENTION_THRESHOLD, DEFAULT_JEV_NEIGHBOR_THRESHOLD} from '@codeyantram/shared';

function retainHeadings(chunk: ContentChunk, retained: Set<number>) {
  for (const position of chunk.headingPositions) retained.add(position);
}

function retainAdjacentContext(chunks: ContentChunk[], chunk: ContentChunk, retained: Set<number>) {
  for (const offset of [-1, 1]) {
    if (chunks[chunk.position + offset]?.sectionPath.join('\0') === chunk.sectionPath.join('\0')) retained.add(chunk.position + offset);
  }
}

export function retainedPositions(chunks: ContentChunk[], judgments: Map<number, number>, threshold = DEFAULT_JEV_RETENTION_THRESHOLD, neighborThreshold = DEFAULT_JEV_NEIGHBOR_THRESHOLD): Set<number> {
  const retained = new Set<number>();
  for (const chunk of chunks) {
    const probability = judgments.get(chunk.position);
    if (retainUncertainEvidence(probability, threshold)) {
      retained.add(chunk.position);
      retainHeadings(chunk, retained);
      // Keep adjacent context for positively identified evidence; uncertainty still retains itself and headings.
      if (probability !== undefined && probability >= neighborThreshold) retainAdjacentContext(chunks, chunk, retained);
    }
  }
  retainCodeBlocks(chunks, retained);
  return retained;
}

function retainCodeBlocks(chunks: ContentChunk[], retained: Set<number>) {
  // Preserve complete fenced examples when any part survives classification.
  const keptBlocks = new Set(chunks.filter(chunk => retained.has(chunk.position) && chunk.codeBlock !== undefined).map(chunk => chunk.codeBlock));
  for (const chunk of chunks) if (chunk.codeBlock !== undefined && keptBlocks.has(chunk.codeBlock)) {
    retained.add(chunk.position);
    retainHeadings(chunk, retained);
  }
}
