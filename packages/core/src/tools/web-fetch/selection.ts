import {performance} from 'node:perf_hooks';
import type {TokenUsage} from '@codeyantram/shared';
import {evaluationCapability, evaluationObjective, evaluationStatus} from '../../evaluation/index.js';
import {evaluateChunks} from './evaluation-batches.js';
import {retainedPositions} from './retained-content.js';
import {chunkContent, ChunkLimitError, type ContentChunk} from './chunks.js';
import {MAX_EVALUATED_CHUNKS, MIN_FILTER_CHARACTERS} from './limits.js';
import type {FilteringMetadata, JevCapability, WebFormat} from './types.js';

export interface Selection {content: string; filtering: FilteringMetadata; warnings: string[]}

export async function selectContent(content: string, sourceUrl: string, format: WebFormat, options: {
  jev?: JevCapability; objective?: string; filter?: boolean; signal?: AbortSignal;
}): Promise<Selection> {
  options.signal?.throwIfAborted();
  const early = earlySelection(content, format, options);
  if ('content' in early) return early;
  const objective = evaluationObjective(options.objective);
  if (objective === undefined || objective === '') return skippedSelection(content, 'no_objective');
  if (content.length < MIN_FILTER_CHARACTERS) return skippedSelection(content, 'small_document');
  let chunks: ContentChunk[];
  try { chunks = chunkContent(content, sourceUrl); }
  catch (error) {
    if (!(error instanceof ChunkLimitError)) throw error;
    return skippedSelection(content, 'chunk_limit', 'JEV filtering skipped: document structure exceeds the chunking limit. Normal content returned.');
  }
  const evaluator = early.evaluator;
  const candidates = chunks.slice(0, MAX_EVALUATED_CHUNKS);
  const judgments = new Map<number, number>();
  const usage: TokenUsage = {};
  const started = performance.now();
  await evaluateChunks(candidates, evaluator, {objective, signal: options.signal, judgments, usage});
  options.signal?.throwIfAborted();
  const retained = retainedPositions(chunks, judgments);
  return buildSelection(content, chunks, {judgments, evaluatedChunkLimit: candidates.length, usage, started, retained});
}

function buildSelection(content: string, chunks: ContentChunk[], context: {
  judgments: Map<number, number>; evaluatedChunkLimit: number; usage: TokenUsage; started: number; retained: Set<number>;
}): Selection {
  const {judgments, evaluatedChunkLimit, usage, started, retained} = context;
  // An all-negative response is recoverable without requiring another fetch.
  if (!retained.size) return {content, warnings: ['JEV selected no evidence; normal content returned.'], filtering: {
    status: 'completed', reason: 'no_evidence', totalChunks: chunks.length, evaluatedChunks: judgments.size, retainedChunks: chunks.length,
    incomplete: false, durationMs: performance.now() - started, ...(Object.keys(usage).length ? {usage} : {}),
  }};
  const incomplete = judgments.size < chunks.length;
  let previous = -1;
  const selected: string[] = [];
  for (const chunk of chunks) if (retained.has(chunk.position)) {
    if (chunk.position !== previous + 1) selected.push('\n\n[Irrelevant source section omitted]\n\n');
    selected.push(chunk.text); previous = chunk.position;
  }
  const selectedContent = selected.join('');
  let warnings: string[];
  const status = evaluationStatus(chunks.length, judgments.size);
  if (judgments.size === 0) {
    warnings = ['JEV filtering skipped: evaluation failed or timed out. Normal content returned.'];
  } else if (judgments.size < evaluatedChunkLimit) {
    warnings = ['JEV evaluation was incomplete; unevaluated content was retained.'];
  } else if (incomplete) {
    // The configured evaluation budget was reached; remaining chunks were deliberately retained.
    warnings = [];
  } else {
    warnings = [];
  }
  return {content: selectedContent, warnings, filtering: {
    status,
    totalChunks: chunks.length, evaluatedChunks: judgments.size, retainedChunks: retained.size, incomplete,
    durationMs: performance.now() - started, ...(Object.keys(usage).length ? {usage} : {}),
  }};
}

function skippedSelection(content: string, reason: string, warning?: string): Selection {
  return {content,
    filtering: {status: 'skipped', reason, totalChunks: 0, evaluatedChunks: 0, retainedChunks: 0, incomplete: false},
    warnings: (warning !== undefined && warning !== '') ? [warning] : [],
  };
}

function earlySelection(content: string, format: WebFormat, options: {jev?: JevCapability; filter?: boolean}): Selection | Extract<JevCapability, {status: 'available'}> {
  const capability = evaluationCapability(options.jev, options.filter);
  if (capability.status === 'skipped') {
    let warning: string | undefined;
    if (capability.reason === 'missing_credentials') warning = 'JEV filtering skipped: configure TypeSafe through /connect. Normal content returned.';
    if (capability.reason === 'initialization_failed') warning = 'JEV filtering skipped: evaluation could not be initialized. Normal content returned.';
    return skippedSelection(content, capability.reason, warning);
  }
  if (format === 'html') return skippedSelection(content, 'raw_html');
  return capability;
}
