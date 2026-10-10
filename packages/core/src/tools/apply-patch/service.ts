import {realpath} from 'node:fs/promises';
import {abortable} from '../../evaluation/cancellation.js';
import {ApplyPatchError, mapPatchError} from './errors.js';
import {parsePatch} from './parser.js';
import {preparePatch} from './plan.js';
import {applyPatchInputSchema} from './schema.js';
import {commitPatch} from './write.js';
import type {ApplyPatchService, PatchApprover} from './types.js';

let pendingWrites: Promise<unknown> = Promise.resolve();

export function createApplyPatchService(options: {workspaceRoot: string; approve: PatchApprover}): ApplyPatchService {
  if (!options.workspaceRoot.trim() || typeof options.approve !== 'function') {
    throw new ApplyPatchError('permission_denied', 'The host must supply a workspace root and patch approval callback.');
  }
  const {workspaceRoot, approve} = options;
  return {apply(input, context = {}) {
    const run = pendingWrites.then(async () => {
      try {return await applyApprovedPatch({workspaceRoot, approve}, input, context);}
      catch (error) {context.abortSignal?.throwIfAborted(); throw mapPatchError(error);}
    });
    pendingWrites = run.then(() => null, () => null);
    return context.abortSignal ? abortable(run, context.abortSignal) : run;
  }};
}

async function applyApprovedPatch(options: {workspaceRoot: string; approve: PatchApprover},
  input: Parameters<ApplyPatchService['apply']>[0], context: {objective?: string; abortSignal?: AbortSignal}) {
  const signal = context.abortSignal;
  signal?.throwIfAborted();
  const parsed = applyPatchInputSchema.safeParse(input);
  if (!parsed.success) throw new ApplyPatchError('invalid_input', 'Provide bounded patchText and expectedHashes.');
  const changes = parsePatch(parsed.data.patchText);
  const root = await realpath(options.workspaceRoot);
  const plan = await preparePatch(root, changes, parsed.data, signal);
  signal?.throwIfAborted();
  const request = {patchText: parsed.data.patchText, objective: context.objective,
    changes: plan.map(item => ({filePath: item.change.filePath, action: item.change.action, beforeHash: item.before?.hash ?? null, afterHash: item.afterHash}))};
  const approval = options.approve(structuredClone(request), signal);
  const approved: unknown = signal ? await abortable(approval, signal) : await approval;
  if (approved !== true) throw new ApplyPatchError('permission_denied', 'The host did not approve this exact patch. No target files were changed.');
  signal?.throwIfAborted();
  const applied = await commitPatch(root, plan, signal);
  const warnings = ['Multi-file writes are not transactional; re-read after interruption. Run tests separately to verify changes.'];
  return {applied, warnings};
}
