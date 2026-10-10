import type {ApplyPatchInput} from './schema.js';

export interface PatchChange {
  filePath: string;
  action: 'add' | 'update' | 'delete';
  lines: string[];
}

export interface PatchApprovalRequest {
  patchText: string;
  objective?: string;
  changes: {filePath: string; action: PatchChange['action']; beforeHash: string | null; afterHash: string | null}[];
}

export type PatchApprover = (request: PatchApprovalRequest, signal?: AbortSignal) => Promise<boolean>;

export interface ApplyPatchOutput {
  applied: {filePath: string; action: PatchChange['action']; contentHash: string | null}[];
  warnings: string[];
}

export interface ApplyPatchService {
  apply(input: ApplyPatchInput, context?: {objective?: string; abortSignal?: AbortSignal}): Promise<ApplyPatchOutput>;
}
