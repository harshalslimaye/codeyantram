import type {EvaluationMetadata} from '../../evaluation/index.js';
import type {GlobInput} from './schema.js';

export interface GlobDiscoveryResult {files: string[]; truncated: boolean; incomplete: boolean; warnings: string[]}
export interface GlobFilteringMetadata extends EvaluationMetadata {
  mode: 'rank'; totalCandidates: number; evaluatedCandidates: number; retainedCandidates: number;
}
export interface GlobOutput extends GlobDiscoveryResult {
  pattern: string; path: string; coverage: string; untrusted: true; filtering: GlobFilteringMetadata;
}
export interface GlobTransport {discover(input: GlobInput, signal: AbortSignal): Promise<GlobDiscoveryResult>}
export interface GlobContext {abortSignal?: AbortSignal; objective?: string}
export interface GlobService {discover(input: GlobInput, context?: GlobContext): Promise<GlobOutput>}
