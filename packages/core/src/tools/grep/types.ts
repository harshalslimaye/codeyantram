import type {EvaluationMetadata} from '../../evaluation/index.js';
import type {GrepInput} from './schema.js';

export interface GrepMatch {
  filePath: string;
  line: number;
  column: number;
  text: string;
  textStartColumn: number;
  textTruncated: boolean;
}
export interface GrepSearchResult {
  matches: GrepMatch[];
  truncated: boolean;
  incomplete: boolean;
  warnings: string[];
}
export interface GrepFilteringMetadata extends EvaluationMetadata {
  mode: 'rank';
  totalCandidates: number;
  evaluatedCandidates: number;
  retainedCandidates: number;
}
export interface GrepOutput extends GrepSearchResult {
  pattern: string;
  path: string;
  coverage: string;
  untrusted: true;
  filtering: GrepFilteringMetadata;
}
export interface GrepTransport {search(input: GrepInput, signal: AbortSignal): Promise<GrepSearchResult>}
export interface GrepContext {abortSignal?: AbortSignal; objective?: string}
export interface GrepService {search(input: GrepInput, context?: GrepContext): Promise<GrepOutput>}
