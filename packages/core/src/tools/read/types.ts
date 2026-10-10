import type {EvaluationMetadata} from '../../evaluation/index.js';
import type {ReadInput} from './schema.js';

export interface ReadLine {number: number; text: string; truncated: boolean}
export interface ReadRange {startLine: number; endLine: number; text: string}
export interface ReadFilteringMetadata extends EvaluationMetadata {
  totalChunks: number;
  evaluatedChunks: number;
  retainedChunks: number;
}
export interface ReadOutput {
  filePath: string;
  contentHash: string;
  totalLines: number;
  offset: number;
  nextOffset: number | null;
  ranges: ReadRange[];
  untrusted: true;
  truncation: {truncated: boolean; lineTruncated: boolean};
  filtering: ReadFilteringMetadata;
  warnings: string[];
}
export interface ReadContext {abortSignal?: AbortSignal; objective?: string}
export interface ReadService {read(input: ReadInput, context?: ReadContext): Promise<ReadOutput>}
