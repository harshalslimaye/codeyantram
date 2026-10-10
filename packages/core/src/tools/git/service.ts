import {resolve} from 'node:path';
import type {JevCapability} from '../../evaluation/index.js';
import {deadline} from '../../evaluation/cancellation.js';
import {GitError} from './errors.js';
import {DEFAULT_GIT_LOG_ENTRIES, GIT_TIMEOUT_MS, MAX_GIT_ENTRIES} from './limits.js';
import {gitWorkspaceRoot, runGit} from './process.js';
import {gitDiffInputSchema, gitLogInputSchema, gitShowInputSchema, gitStatusInputSchema} from './schema.js';
import {rankGitEntries} from './selection.js';
import type {GitContext, GitService} from './types.js';

type Operation = 'status' | 'diff' | 'log' | 'show';
const COVERAGE = new Map<Operation, string>([
  ['status', 'Porcelain status includes tracked and untracked paths; ignored files are omitted. The working tree may change after this snapshot.'],
  ['diff', 'Tracked-file diff only; untracked files are omitted. Binary content and truncated output are not complete evidence.'],
  ['log', 'Recent reachable commits only, limited to commit IDs and subjects. History and messages may be incomplete.'],
  ['show', 'One commit and its patch. Binary content and truncated output are not complete evidence.'],
]);

export function createGitService(options: {workspaceRoot: string; jev?: JevCapability}): GitService {
  if (!options.workspaceRoot.trim()) throw new GitError('invalid_input', 'The host must provide a workspace root.');
  const workspaceRoot = resolve(options.workspaceRoot);
  const jev = options.jev;
  const execute = (operation: Operation, args: string[], input: {query?: string; filter?: boolean}, context?: GitContext) =>
    executeGit({workspaceRoot, jev, operation, args, input, context});
  return {
    async status(input, context) {
      const parsed = gitStatusInputSchema.safeParse(input);
      if (!parsed.success) throw new GitError('invalid_input', 'Provide a valid Git status path and options.');
      return execute('status', ['status', '--porcelain=v1', '--untracked-files=normal', '--no-renames',
        '--', parsed.data.path ?? '.'], parsed.data, context);
    },
    async diff(input, context) {
      const parsed = gitDiffInputSchema.safeParse(input);
      if (!parsed.success) throw new GitError('invalid_input', 'Provide a valid Git diff path and options.');
      return execute('diff', ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames',
        ...(parsed.data.staged === true ? ['--cached'] : []), '--', parsed.data.path ?? '.'], parsed.data, context);
    },
    async log(input, context) {
      const parsed = gitLogInputSchema.safeParse(input);
      if (!parsed.success) throw new GitError('invalid_input', 'Provide a valid Git log path and limit.');
      return execute('log', ['log', '--no-notes', '--no-show-signature', '--format=%H%x09%s', '-n', String(parsed.data.limit ?? DEFAULT_GIT_LOG_ENTRIES),
        '--', parsed.data.path ?? '.'], parsed.data, context);
    },
    async show(input, context) {
      const parsed = gitShowInputSchema.safeParse(input);
      if (!parsed.success) throw new GitError('invalid_input', 'Provide a commit hash or bounded HEAD ancestor.');
      return execute('show', ['show', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames',
        '--no-notes', '--no-show-signature', '-m', '--first-parent', '--format=%H%x09%s',
        `${parsed.data.revision ?? 'HEAD'}^{commit}`], parsed.data, context);
    },
  };
}

async function executeGit(settings: {workspaceRoot: string; jev?: JevCapability; operation: Operation;
  args: string[]; input: {query?: string; filter?: boolean}; context?: GitContext}) {
  const {workspaceRoot, jev, operation, args, input, context = {}} = settings;
  context.abortSignal?.throwIfAborted();
  const scope = deadline(GIT_TIMEOUT_MS, context.abortSignal, {
    timeout: () => new GitError('timeout', 'Git inspection timed out. Narrow the request.'),
    cancelled: () => new GitError('execution_failed', 'Git inspection cancelled.'),
  });
  let output: Awaited<ReturnType<typeof runGit>>;
  try {
    const root = await gitWorkspaceRoot(workspaceRoot, scope.signal);
    output = await runGit(root, args, scope.signal);
  } catch (error) {
    context.abortSignal?.throwIfAborted();
    throw error;
  } finally {scope.dispose();}
  const parsed = parseGitOutput(operation, output.stdout, output.truncated);
  const ranked = await rankGitEntries(parsed.entries, {jev, operation,
    objective: input.query ?? context.objective, filter: input.filter, signal: context.abortSignal});
  return {entries: ranked.entries, ...(parsed.summary === undefined ? {} : {summary: parsed.summary}),
    truncated: parsed.truncated, incomplete: parsed.truncated, coverage: COVERAGE.get(operation) ?? '', untrusted: true as const,
    filtering: ranked.filtering, warnings: [...parsed.warnings, ...ranked.warnings]};
}

function parseGitOutput(operation: Operation, stdout: string, processTruncated: boolean) {
  const summary = operation === 'show' ? stdout.split('\n', 1)[0] : undefined;
  const source = operation === 'show' ? stdout.slice(stdout.indexOf('\n') + 1) : stdout;
  const entries = operation === 'status' || operation === 'log' ? splitLines(source, processTruncated) : splitDiff(source);
  const truncated = processTruncated || entries.length > MAX_GIT_ENTRIES;
  const warnings = truncated ? ['Git output reached a result or byte limit; narrow the request.'] : [];
  return {entries: entries.slice(0, MAX_GIT_ENTRIES), summary, truncated, warnings};
}

function splitLines(source: string, processTruncated: boolean): string[] {
  const entries = source.split('\n').filter(Boolean);
  if (processTruncated && !source.endsWith('\n')) entries.pop();
  return entries;
}

function splitDiff(source: string): string[] {
  const starts = [...source.matchAll(/^diff --git /gm)].map(match => match.index);
  return starts.map((start, position) => source.slice(start, starts[position + 1] ?? source.length));
}
