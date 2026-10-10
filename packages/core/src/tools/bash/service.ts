import {isAbsolute} from 'node:path';
import {abortable} from '../../evaluation/cancellation.js';
import {BashError, mapBashError} from './errors.js';
import {commandEnvironment} from './environment.js';
import {DEFAULT_COMMAND_TIMEOUT_MS} from './limits.js';
import {commandDirectory} from './paths.js';
import {runBashCommand} from './process.js';
import {bashInputSchema} from './schema.js';
import type {BashApprovalRequest, BashApprover, BashService} from './types.js';

export function createBashService(options: {
  workspaceRoot: string; approve: BashApprover; environment?: Record<string, string>; shellPath?: string;
}): BashService {
  const shellPath = options.shellPath ?? '/bin/bash';
  if (!options.workspaceRoot.trim() || typeof options.approve !== 'function') {
    throw new BashError('permission_denied', 'The host must provide a workspace root and command permission callback.');
  }
  if (!isAbsolute(shellPath) || shellPath.includes('\0')) throw new BashError('invalid_input', 'The host shell path must be absolute.');
  const settings = {workspaceRoot: options.workspaceRoot, approve: options.approve, shellPath,
    environment: commandEnvironment(options.environment)};
  return {async run(input, context = {}) {
    try {return await runApprovedCommand(settings, input, context);}
    catch (error) {context.abortSignal?.throwIfAborted(); throw mapBashError(error);}
  }};
}

async function runApprovedCommand(settings: {
  workspaceRoot: string; approve: BashApprover; shellPath: string; environment: Record<string, string>;
}, input: Parameters<BashService['run']>[0], context: {objective?: string; abortSignal?: AbortSignal}) {
  const signal = context.abortSignal;
  signal?.throwIfAborted();
  const parsed = bashInputSchema.safeParse(input);
  if (!parsed.success) throw new BashError('invalid_input', 'Provide a bounded command, workspace-relative workdir, and timeoutMs from 1 to 120000.');
  const args = parsed.data;
  const directory = await commandDirectory(settings.workspaceRoot, args.workdir ?? '.');
  const timeoutMs = args.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  signal?.throwIfAborted();
  const request = {command: args.command, workdir: directory.workdir, timeoutMs, objective: context.objective};
  await permitCommand(settings.approve, request, signal);
  signal?.throwIfAborted();
  const current = await commandDirectory(settings.workspaceRoot, args.workdir ?? '.');
  if (directory.cwd !== current.cwd || directory.root !== current.root) throw new BashError('permission_denied', 'The command directory changed after permission was granted. Request permission again.');
  return runBashCommand({command: args.command, ...directory, timeoutMs, shellPath: settings.shellPath,
    environment: settings.environment, signal});
}

async function permitCommand(approve: BashApprover, request: BashApprovalRequest, signal?: AbortSignal) {
  const permission = approve(structuredClone(request), signal);
  const allowed: unknown = signal ? await abortable(permission, signal) : await permission;
  if (allowed !== true) throw new BashError('permission_denied', 'The host did not permit this exact command. No command was started.');
}
