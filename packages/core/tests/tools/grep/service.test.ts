import {mkdtemp, mkdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createGrepService, createGrepTool, createToolExecutor, createReadTool, createReadService, grepInputSchema, type GrepTransport} from '../../../src/index.js';
import {requireValue, asymmetric} from '../../../../shared/tests/helpers.js';

let directory: string;
let root: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'codeyantram-grep-'));
  root = join(directory, 'workspace');
  await mkdir(root);
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await rm(directory, {recursive: true, force: true});
});
const execution = (toolCallId = 'grep-1') => ({toolCallId, messages: [], context: {}});

describe('workspace grep service', () => {
  it('searches exact lines without graph indexing and preserves byte columns', async () => {
    await writeFile(join(root, 'file.ts'), 'header\n🙂 needle needle\nlast\n');
    const result = await createGrepService({workspaceRoot: root}).search({pattern: 'needle'});
    expect(result).toMatchObject({path: '.', matches: [{filePath: 'file.ts', line: 2, column: 6,
      text: '🙂 needle needle', textStartColumn: 1, textTruncated: false}],
      truncated: false, incomplete: false, untrusted: true, filtering: {status: 'skipped', reason: 'disabled'},
    });
    expect(result.matches).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it('supports regex, literal mode, case-insensitive search, file scopes, and include globs', async () => {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'a.ts'), 'Hello123\na.b\naxb');
    await writeFile(join(root, 'b.txt'), 'Hello456');
    const service = createGrepService({workspaceRoot: root});
    expect((await service.search({pattern: 'hello\\d+', ignoreCase: true, include: '*.ts'})).matches.map(match => match.filePath)).toEqual(['src/a.ts']);
    expect((await service.search({pattern: 'a.b', fixedStrings: true, path: 'src'})).matches.map(match => match.text)).toEqual(['a.b']);
    expect((await service.search({pattern: 'Hello', path: 'b.txt'})).matches).toHaveLength(1);
    expect((await service.search({pattern: 'hello'})).matches).toEqual([]);
  });

  it('honors ignore files and hidden-file defaults independently of Git initialization', async () => {
    await writeFile(join(root, '.gitignore'), 'ignored.txt\n');
    await writeFile(join(root, 'ignored.txt'), 'needle');
    await writeFile(join(root, '.hidden'), 'needle');
    await writeFile(join(root, 'visible.txt'), 'needle');
    const service = createGrepService({workspaceRoot: root});
    expect((await service.search({pattern: 'needle'})).matches.map(match => match.filePath)).toEqual(['visible.txt']);
    expect((await service.search({pattern: 'needle', path: '.hidden'})).matches).toHaveLength(1);
  });

  it('rejects symlink escapes and does not follow symlinked directories during recursive search', async () => {
    await writeFile(join(directory, 'secret'), 'PRIVATE needle');
    await symlink(directory, join(root, 'escape'));
    await writeFile(join(root, 'safe'), 'needle');
    const service = createGrepService({workspaceRoot: root});
    await expect(service.search({pattern: 'needle', path: 'escape/secret'})).rejects.toMatchObject({code: 'permission_denied'});
    expect((await service.search({pattern: 'needle'})).matches.map(match => match.filePath)).toEqual(['safe']);
  });

  it('treats option-like patterns and shell metacharacters as data', async () => {
    const pattern = '--flag; $(touch SHOULD_NOT_EXIST)';
    await writeFile(join(root, 'file'), pattern);
    const result = await createGrepService({workspaceRoot: root}).search({pattern, fixedStrings: true});
    expect(result.matches[0]?.text).toBe(pattern);
    await writeFile(join(root, '-'), 'needle');
    expect((await createGrepService({workspaceRoot: root}).search({pattern: 'needle', path: '-'})).matches[0]?.filePath).toBe('-');
  });

  it('bounds results and reports incomplete search coverage without JEV dropping matches', async () => {
    await writeFile(join(root, 'file'), 'needle\n'.repeat(30));
    const result = await createGrepService({workspaceRoot: root}).search({pattern: 'needle', limit: 3});
    expect(result.matches).toHaveLength(3);
    expect(result).toMatchObject({truncated: true, incomplete: true});
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('centers bounded source excerpts on distant matches and keeps original columns', async () => {
    await writeFile(join(root, 'long'), '🙂'.repeat(1000) + 'needle' + 'x'.repeat(2000));
    const result = await createGrepService({workspaceRoot: root}).search({pattern: 'needle'});
    const match = requireValue(result.matches[0]);
    expect(match.column).toBe(4001);
    expect(match.text).toContain('needle');
    expect(match.text.length).toBeLessThanOrEqual(1000);
    expect(match.textTruncated).toBe(true);
    expect(match.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
  });

  it('bounds serialized output for escaped match content', async () => {
    await writeFile(join(root, 'escaped'), ('needle ' + '\u0001'.repeat(1000) + '\n').repeat(100));
    const result = await createGrepService({workspaceRoot: root}).search({pattern: 'needle'});
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThan(60000);
    expect(result.truncated).toBe(true);
  });

  it('returns empty results for no matches and skips oversized or binary files', async () => {
    await writeFile(join(root, 'big'), 'needle'.repeat(200000));
    await writeFile(join(root, 'binary'), Buffer.from('needle\0binary'));
    expect((await createGrepService({workspaceRoot: root}).search({pattern: 'absent'})).matches).toEqual([]);
    expect((await createGrepService({workspaceRoot: root}).search({pattern: 'needle'})).matches).toEqual([]);
  });

  it('sanitizes invalid regex, missing paths, and missing ripgrep errors', async () => {
    const service = createGrepService({workspaceRoot: root});
    await expect(service.search({pattern: '['})).rejects.toMatchObject({code: 'invalid_input'});
    await expect(service.search({pattern: '(?=needle)'})).rejects.toMatchObject({code: 'invalid_input'});
    await expect(service.search({pattern: 'needle', path: 'missing'})).rejects.toMatchObject({code: 'not_found'});
    vi.stubEnv('PATH', root);
    await expect(service.search({pattern: 'needle'})).rejects.toMatchObject({code: 'execution_failed', message: asymmetric.stringContaining('ripgrep')});
  });

  it.each([{pattern: ''}, {pattern: 'x\n'}, {pattern: 'x', path: '../outside'}, {pattern: 'x', path: '/absolute'},
    {pattern: 'x', limit: 201}, {pattern: 'x', workspaceRoot: '/other'}, {pattern: 'x', shell: true}, {pattern: 'x', query: ' '}])('rejects unsafe arguments (case %#)', input => {
    expect(grepInputSchema.safeParse(input).success).toBe(false);
  });

  it('validates direct callers and propagates pre-cancellation before search', async () => {
    const transport = {search: vi.fn<GrepTransport['search']>()};
    const service = createGrepService({workspaceRoot: root, transport});
    await expect(service.search({pattern: 'x', path: '../outside'})).rejects.toMatchObject({code: 'invalid_input'});
    await expect(service.search({pattern: 'x'}, {abortSignal: AbortSignal.abort(new Error('stop'))})).rejects.toThrow('stop');
    expect(transport.search).not.toHaveBeenCalled();
  });

  it('enforces search deadlines and cancellation even for a non-cooperative transport', async () => {
    vi.useFakeTimers();
    const transport: GrepTransport = {search: () => new Promise(() => {})};
    const service = createGrepService({workspaceRoot: root, transport});
    const pending = service.search({pattern: 'x'});
    const checked = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await checked).toMatchObject({code: 'timeout'});
    const controller = new AbortController();
    const cancelled = service.search({pattern: 'x'}, {abortSignal: controller.signal});
    controller.abort(new Error('stop'));
    await expect(cancelled).rejects.toThrow('stop');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the shared tool error envelope and per-turn execution budget', async () => {
    await writeFile(join(root, 'file'), 'needle');
    const execute = createToolExecutor();
    const grep = createGrepTool(createGrepService({workspaceRoot: root}), execute);
    const read = createReadTool(createReadService({workspaceRoot: root}), execute);
    expect(await requireValue(grep.execute)({pattern: '['}, execution())).toMatchObject({status: 'error', error: {code: 'invalid_input'}});
    for (let position = 0; position < 11; position++) await requireValue(read.execute)({filePath: 'file'}, execution(`read-${position}`));
    expect(await requireValue(grep.execute)({pattern: 'needle'}, execution('extra'))).toMatchObject({status: 'error', error: {code: 'tool_limit'}});
  });
});
