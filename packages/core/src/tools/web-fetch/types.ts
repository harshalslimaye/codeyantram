import type {EvaluationMetadata} from '../../evaluation/index.js';
export type {JevCapability} from '../../evaluation/index.js';
import type {WebFetchInput} from './schema.js';

export type WebFormat = 'markdown' | 'text' | 'html';
export interface TransportDocument {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  text: string;
}
export interface WebTransport {
  fetch(url: string, format: WebFormat, signal: AbortSignal): Promise<TransportDocument>;
}
export interface FilteringMetadata extends EvaluationMetadata {
  totalChunks: number;
  evaluatedChunks: number;
  retainedChunks: number;
}
export interface WebFetchOutput {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  format: WebFormat;
  content: string;
  untrusted: true;
  warnings: string[];
  truncation: {truncated: boolean; originalCharacters: number; selectedCharacters: number; returnedCharacters: number};
  filtering: FilteringMetadata;
}
export interface WebFetchContext {
  abortSignal?: AbortSignal;
  /** Only the latest user request, never the conversation or fetched instructions. */
  objective?: string;
}
export interface WebFetchService {
  fetch(input: WebFetchInput, context?: WebFetchContext): Promise<WebFetchOutput>;
}
