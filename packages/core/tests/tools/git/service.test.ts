import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createGitService, createGitTools, createToolExecutor, gitDiffInputSchema, gitLogInputSchema,
  gitShowInputSchema, gitStatusInputSchema} from '../../../src/index.js';
import type {EvaluationInput, EvaluationQuestions, EvaluationResult, JevEvaluator} from '../../../src/index.js';
import {requireValue} from '../../../../shared/tests/helpers.js';

let directory: string;
let root: string;
const git = (args: string[]) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8'});
const execution = (toolCallId = 'git-1') => ({toolCallId, messages: [], context: {}});

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'codeyantram-git-'));
  root = join(directory, 'workspace');
  await mkdir(root);
  git(['init', '-q']);
  await writeFile(join(root, 'alpha.txt'), 'alpha before\n');
  await writeFile(join(root, 'beta.txt'), 'beta before\n');
  git(['add', '--', 'alpha.txt', 'beta.txt']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'initial snapshot']);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, {recursive: true, force: true});
});

describe('read-only Git tools', () => {
  it('reports status, tracked diffs, recent commits, and a commit patch', async () => {
    await writeFile(join(root, 'alpha.txt'), 'alpha after\n');
    await writeFile(join(root, 'untracked.txt'), 'untracked secret\n');
    const service = createGitService({workspaceRoot: root});
    const status = await service.status({});
    expect(status.entries).toEqual(expect.arrayContaining([' M alpha.txt', '?? untracked.txt']));
    expect(status).toMatchObject({truncated: false, incomplete: false, untrusted: true,
      filtering: {status: 'skipped', reason: 'disabled', totalCandidates: 2, retainedCandidates: 2}});
    const diff = await service.diff({});
    expect(diff.entries).toHaveLength(1);
    expect(diff.entries[0]).toContain('+alpha after');
    expect(JSON.stringify(diff)).not.toContain('untracked secret');
    const log = await service.log({limit: 1});
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatch(/^[a-f0-9]{40}\tinitial snapshot$/);
    const show = await service.show({revision: 'HEAD'});
    expect(show.summary).toMatch(/^[a-f0-9]{40}\tinitial snapshot$/);
    expect(show.entries).toHaveLength(2);
    expect(show.entries[0]).toContain('diff --git a/alpha.txt b/alpha.txt');
  });

  it('scopes paths and distinguishes staged from unstaged changes', async () => {
    await writeFile(join(root, 'alpha.txt'), 'staged alpha\n');
    git(['add', '--', 'alpha.txt']);
    await writeFile(join(root, 'beta.txt'), 'unstaged beta\n');
    const service = createGitService({workspaceRoot: root});
    expect((await service.diff({staged: true})).entries.join('\n')).toContain('+staged alpha');
    expect((await service.diff({staged: true})).entries.join('\n')).not.toContain('unstaged beta');
    expect((await service.diff({path: 'beta.txt'})).entries.join('\n')).toContain('+unstaged beta');
    expect((await service.status({path: 'alpha.txt'})).entries).toEqual(['M  alpha.txt']);
    expect((await service.log({path: 'alpha.txt'})).entries).toHaveLength(1);
  });

  it('shows a merge commit relative to its first parent', async () => {
    const originalBranch = git(['branch', '--show-current']).trim();
    git(['checkout', '-qb', 'feature']);
    await writeFile(join(root, 'beta.txt'), 'feature change\n');
    git(['add', '--', 'beta.txt']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'feature commit']);
    git(['checkout', '-q', originalBranch]);
    await writeFile(join(root, 'alpha.txt'), 'main change\n');
    git(['add', '--', 'alpha.txt']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'main commit']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'merge', '-q', '--no-ff', '-m', 'merge feature', 'feature']);
    const shown = await createGitService({workspaceRoot: root}).show({});
    expect(shown.summary).toContain('merge feature');
    expect(shown.entries.join('\n')).toContain('+feature change');
  });

  it('rejects unsafe arguments and repository roots outside the workspace', async () => {
    const service = createGitService({workspaceRoot: root});
    expect(gitStatusInputSchema.safeParse({path: '../outside'}).success).toBe(false);
    expect(gitDiffInputSchema.safeParse({path: '--cached'}).success).toBe(true);
    expect(gitLogInputSchema.safeParse({limit: 51}).success).toBe(false);
    expect(gitShowInputSchema.safeParse({revision: 'HEAD:alpha.txt'}).success).toBe(false);
    expect(gitShowInputSchema.safeParse({revision: '--help'}).success).toBe(false);
    await expect(service.show({revision: '--help'})).rejects.toMatchObject({code: 'invalid_input'});
    await writeFile(join(root, 'alpha.txt'), 'changed\n');
    expect((await service.status({path: ':(top)alpha.txt'})).entries).toEqual([]);
    await mkdir(join(root, 'subdir'));
    await expect(createGitService({workspaceRoot: join(root, 'subdir')}).status({})).rejects.toMatchObject({code: 'invalid_input'});
    await expect(service.status({}, {abortSignal: AbortSignal.abort(new Error('stop'))})).rejects.toThrow('stop');
  });

  it('bounds large output independently of JEV metadata', async () => {
    await writeFile(join(root, 'alpha.txt'), 'large\n'.repeat(20_000));
    const result = await createGitService({workspaceRoot: root}).diff({});
    expect(result).toMatchObject({truncated: true, incomplete: true, filtering: {status: 'skipped', reason: 'disabled'}});
    expect(result.warnings).toContain('Git output reached a result or byte limit; narrow the request.');
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(80_000);
  });

  it('warns when JEV is unavailable without dropping Git entries', async () => {
    await writeFile(join(root, 'alpha.txt'), 'changed\n');
    await writeFile(join(root, 'untracked.txt'), 'new\n');
    const result = await createGitService({workspaceRoot: root,
      jev: {status: 'unavailable', reason: 'missing_credentials'}}).status({query: 'inspect changes'});
    expect(result.entries).toHaveLength(2);
    expect(result.filtering).toMatchObject({status: 'skipped', reason: 'missing_credentials'});
    expect(result.warnings).toContain('JEV evaluation unavailable; original Git order returned.');
  });

  it('passes structured failures through the shared tool executor', async () => {
    const tools = createGitTools(createGitService({workspaceRoot: root}), createToolExecutor());
    expect(Object.keys(tools)).toEqual(['git_status', 'git_diff', 'git_log', 'git_show']);
    expect(await requireValue(tools.git_show.execute)({revision: '--help'}, execution())).toMatchObject({
      status: 'error', error: {code: 'invalid_input'},
    });
    expect(await requireValue(tools.git_status.execute)({}, execution('status'))).toMatchObject({
      status: 'success', output: {entries: [], untrusted: true},
    });
  });
});

describe('Git JEV ranking', () => {
  it('ranks entries without dropping any and honors filter:false', async () => {
    await writeFile(join(root, 'alpha.txt'), 'alpha after\n');
    await writeFile(join(root, 'beta.txt'), 'beta after\n');
    const evaluate = vi.fn<(input: EvaluationInput<EvaluationQuestions>) => Promise<EvaluationResult<EvaluationQuestions>>>()
      .mockImplementation(async input => ({modelId: 'fixture', durationMs: 1,
        answers: Object.fromEntries(Object.keys(input.questions).map(id => [id,
          {type: 'boolean', probability: id === 'git-1' ? 0.9 : 0.1}])),
      }));
    const jev = {status: 'available' as const, evaluator: {evaluate} as JevEvaluator};
    const service = createGitService({workspaceRoot: root, jev});
    const ranked = await service.diff({query: 'beta'});
    expect(ranked.entries[0]).toContain('b/beta.txt');
    expect(ranked.entries).toHaveLength(2);
    expect(ranked.filtering).toMatchObject({status: 'completed', totalCandidates: 2, evaluatedCandidates: 2,
      retainedCandidates: 2, incomplete: false});
    expect(evaluate).toHaveBeenCalledOnce();
    const original = await service.diff({query: 'beta', filter: false});
    expect(original.entries[0]).toContain('b/alpha.txt');
    expect(original.filtering).toMatchObject({status: 'skipped', reason: 'disabled_for_request'});
  });
});
