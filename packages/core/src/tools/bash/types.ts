import type {BashInput} from './schema.js';

export interface BashApprovalRequest {
  command: string;
  workdir: string;
  timeoutMs: number;
  objective?: string;
}

export type BashApprover = (request: BashApprovalRequest, signal?: AbortSignal) => Promise<boolean>;

export interface BashOutput {
  workdir: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  termination: 'exit' | 'timeout' | 'output_limit';
  durationMs: number;
  truncated: boolean;
  untrusted: true;
  warnings: string[];
}

export interface BashService {
  run(input: BashInput, context?: {objective?: string; abortSignal?: AbortSignal}): Promise<BashOutput>;
}
