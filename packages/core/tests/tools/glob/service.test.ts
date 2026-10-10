import {mkdtemp, mkdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createGlobService, createGlobTool, createToolExecutor, createReadTool, createReadService, globInputSchema, type GlobTransport} from '../../../src/index.js';
import {requireValue, asymmetric} from '../../../../shared/tests/helpers.js';

let directory: string;
let root: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'codeyantram-glob-'));
  root = join(directory, 'workspace');
  await mkdir(root);
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await rm(directory, {recursive: true, force: true});
});
const execution = (toolCallId = 'glob-1') => ({toolCallId, messages: [], context: {}});

describe('workspace glob discovery', () => {
  it('discovers lexical relative paths without reading file contents or indexing a graph', async () => {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'b.ts'), 'PRIVATE CONTENT');
    await writeFile(join(root, 'a.ts'), 'different source');
    await writeFile(join(root, 'other.txt'), 'text');
    const result = await createGlobService({workspaceRoot: root}).discover({pattern: '**/*.ts'});
    expect(result).toMatchObject({files: ['a.ts', 'src/b.ts'], path: '.', truncated: false, incomplete: false,
      untrusted: true, filtering: {status: 'skipped', reason: 'disabled'}});
    expect(JSON.stringify(result)).not.toContain('PRIVATE CONTENT');
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it('supports directory scopes, brace alternatives, case-insensitivity, and binary/large files', async () => {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'Upper.TS'), Buffer.alloc(1_048_577));
    await writeFile(join(root, 'src', 'image.png'), Buffer.from([0, 255]));
    await writeFile(join(root, 'elsewhere.ts'), 'text');
    const service = createGlobService({workspaceRoot: root});
    expect((await service.discover({pattern: '**/*.{ts,png}', path: 'src', ignoreCase: true})).files).toEqual(['src/Upper.TS', 'src/image.png']);
    expect((await service.discover({pattern: '**/*.ts', path: 'src'})).files).toEqual([]);
    await expect(service.discover({pattern: '**/*.ts', path: 'elsewhere.ts'})).rejects.toMatchObject({code: 'invalid_input'});
  });

  it('requires hidden opt-in and excludes Git internals even when explicitly scoped', async () => {
    await mkdir(join(root, '.git'));
    await writeFile(join(root, '.git', 'config'), 'PRIVATE');
    await writeFile(join(root, '.hidden'), 'text');
    await writeFile(join(root, 'visible'), 'text');
    const service = createGlobService({workspaceRoot: root});
    expect((await service.discover({pattern: '**/*'})).files).toEqual(['visible']);
    expect((await service.discover({pattern: '**/*', hidden: true})).files).toEqual(['.hidden', 'visible']);
    expect((await service.discover({pattern: '**/*', path: '.git', hidden: true})).files).toEqual([]);
  });

  it('documents ripgrep explicit glob precedence over ignore rules', async () => {
    await writeFile(join(root, '.gitignore'), 'ignored.ts\n');
    await writeFile(join(root, 'ignored.ts'), 'text');
    const result = await createGlobService({workspaceRoot: root}).discover({pattern: '**/*.ts'});
    expect(result.files).toEqual(['ignored.ts']);
    expect(result.coverage).toContain('override ignore rules');
  });

  it('uses NUL-separated paths so newline names and sentinel-like names survive unchanged', async () => {
    await writeFile(join(root, 'line\nbreak.ts'), 'text');
    await writeFile(join(root, 'unsupported'), 'text');
    const result = await createGlobService({workspaceRoot: root}).discover({pattern: '**/*'});
    expect(result.files).toEqual(['line\nbreak.ts', 'unsupported']);
    expect(result.incomplete).toBe(false);
  });

  it('rejects symlink escapes and skips recursive symlink traversal', async () => {
    await writeFile(join(directory, 'outside.ts'), 'PRIVATE');
    await symlink(directory, join(root, 'escape'));
    await writeFile(join(root, 'safe.ts'), 'text');
    const service = createGlobService({workspaceRoot: root});
    await expect(service.discover({pattern: '**/*', path: 'escape'})).rejects.toMatchObject({code: 'permission_denied'});
    expect((await service.discover({pattern: '**/*'})).files).toEqual(['safe.ts']);
  });

  it('bounds results and keeps retrieval limits separate from JEV metadata', async () => {
    for (let position = 0; position < 4; position++) await writeFile(join(root, `file-${position}.ts`), 'text');
    const result = await createGlobService({workspaceRoot: root}).discover({pattern: '**/*.ts', limit: 2});
    expect(result).toMatchObject({files: ['file-0.ts', 'file-1.ts'], truncated: true, incomplete: true,
      filtering: {retainedCandidates: 2, incomplete: false}});
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('treats shell metacharacters and option-like patterns as data', async () => {
    const pattern = '--flag; touch SHOULD_NOT_EXIST';
    await writeFile(join(root, pattern), 'text');
    expect((await createGlobService({workspaceRoot: root}).discover({pattern})).files).toEqual([pattern]);
  });

  it('sanitizes malformed globs, missing paths, and missing backend errors', async () => {
    const service = createGlobService({workspaceRoot: root});
    await expect(service.discover({pattern: '{'})).rejects.toMatchObject({code: 'invalid_input'});
    await expect(service.discover({pattern: '*', path: 'missing'})).rejects.toMatchObject({code: 'not_found'});
    vi.stubEnv('PATH', root);
    await expect(service.discover({pattern: '*'})).rejects.toMatchObject({code: 'execution_failed', message: asymmetric.stringContaining('ripgrep')});
  });

  it.each([{pattern: ''}, {pattern: 'x\n'}, {pattern: '*', path: '../outside'}, {pattern: '*', path: '/absolute'},
    {pattern: '*', workspaceRoot: '/other'}, {pattern: '*', limit: 201}, {pattern: '*', shell: true}, {pattern: '*', query: ' '}])('rejects unsafe arguments (case %#)', input => {
    expect(globInputSchema.safeParse(input).success).toBe(false);
  });

  it('validates direct callers and rejects pre-cancelled calls before discovery', async () => {
    const transport = {discover: vi.fn<GlobTransport['discover']>()};
    const service = createGlobService({workspaceRoot: root, transport});
    await expect(service.discover({pattern: '*', path: '../outside'})).rejects.toMatchObject({code: 'invalid_input'});
    await expect(service.discover({pattern: '*'}, {abortSignal: AbortSignal.abort(new Error('stop'))})).rejects.toThrow('stop');
    expect(transport.discover).not.toHaveBeenCalled();
  });

  it('enforces discovery deadlines and cancellation for non-cooperative transports', async () => {
    vi.useFakeTimers();
    const transport: GlobTransport = {discover: () => new Promise(() => {})};
    const service = createGlobService({workspaceRoot: root, transport});
    const checked = service.discover({pattern: '*'}).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await checked).toMatchObject({code: 'timeout'});
    const controller = new AbortController();
    const pending = service.discover({pattern: '*'}, {abortSignal: controller.signal});
    controller.abort(new Error('stop'));
    await expect(pending).rejects.toThrow('stop');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares tool errors and the execution budget with read', async () => {
    await writeFile(join(root, 'file'), 'text');
    const execute = createToolExecutor();
    const glob = createGlobTool(createGlobService({workspaceRoot: root}), execute);
    const read = createReadTool(createReadService({workspaceRoot: root}), execute);
    expect(await requireValue(glob.execute)({pattern: '{'}, execution())).toMatchObject({status: 'error', error: {code: 'invalid_input'}});
    for (let position = 0; position < 11; position++) await requireValue(read.execute)({filePath: 'file'}, execution(`read-${position}`));
    expect(await requireValue(glob.execute)({pattern: '*'}, execution('extra'))).toMatchObject({status: 'error', error: {code: 'tool_limit'}});
  });
});
