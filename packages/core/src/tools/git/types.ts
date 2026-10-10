import type {EvaluationMetadata} from '../../evaluation/index.js';
import type {GitDiffInput, GitLogInput, GitShowInput, GitStatusInput} from './schema.js';

export interface GitFilteringMetadata extends EvaluationMetadata {
  mode: 'rank'; totalCandidates: number; evaluatedCandidates: number; retainedCandidates: number;
}
export interface GitOutput {
  entries: string[];
  summary?: string;
  truncated: boolean;
  incomplete: boolean;
  warnings: string[];
  coverage: string;
  untrusted: true;
  filtering: GitFilteringMetadata;
}
export interface GitContext {abortSignal?: AbortSignal; objective?: string}
export interface GitService {
  status(input: GitStatusInput, context?: GitContext): Promise<GitOutput>;
  diff(input: GitDiffInput, context?: GitContext): Promise<GitOutput>;
  log(input: GitLogInput, context?: GitContext): Promise<GitOutput>;
  show(input: GitShowInput, context?: GitContext): Promise<GitOutput>;
}
