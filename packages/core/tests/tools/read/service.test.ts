import {mkdtemp, mkdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {createReadService, createReadTool, createToolExecutor, createNavigationTools, readInputSchema, type NavigationGraphService} from '../../../src/index.js';
import {requireValue} from '../../../../shared/tests/helpers.js';
import {MAX_FILE_BYTES} from '../../../src/tools/read/limits.js';

let directory: string;
let root: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'codeyantram-read-'));
  root = join(directory, 'workspace');
  await mkdir(root);
});
afterEach(async () => {await rm(directory, {recursive: true, force: true});});
const execution = (toolCallId = 'read-1') => ({toolCallId, messages: [], context: {}});

describe('workspace read service', () => {
  it('reads UTF-8 text without requiring a graph and reports original lines and a snapshot hash', async () => {
    const text = 'first\r\nsecond 🙂\r\nthird\r\n';
    await writeFile(join(root, 'config.txt'), text);
    const output = await createReadService({workspaceRoot: root}).read({filePath: 'config.txt', offset: 2, limit: 1});
    expect(output).toMatchObject({filePath: 'config.txt', totalLines: 3, offset: 2, nextOffset: 3,
      ranges: [{startLine: 2, endLine: 2, text: 'second 🙂'}], untrusted: true,
      contentHash: createHash('sha256').update(text).digest('hex'),
      filtering: {status: 'skipped', reason: 'disabled'}, truncation: {truncated: true, lineTruncated: false},
    });
    expect(JSON.stringify(output)).not.toContain(root);
  });

  it('uses default pagination and supports subsequent pages', async () => {
    await writeFile(join(root, 'many.txt'), Array.from({length: 205}, (_, position) => `line ${position + 1}`).join('\n'));
    const service = createReadService({workspaceRoot: root});
    const first = await service.read({filePath: 'many.txt'});
    expect(first.nextOffset).toBe(201);
    expect(first.ranges.at(-1)?.endLine).toBe(200);
    const last = await service.read({filePath: 'many.txt', offset: 201});
    expect(last.nextOffset).toBeNull();
    expect(last.ranges[0]).toMatchObject({startLine: 201, endLine: 205});
  });

  it('handles empty files and offsets beyond EOF without inventing lines', async () => {
    await writeFile(join(root, 'empty'), '');
    const service = createReadService({workspaceRoot: root});
    expect(await service.read({filePath: 'empty'})).toMatchObject({totalLines: 0, ranges: [], nextOffset: null});
    await writeFile(join(root, 'short'), 'one\n');
    expect(await service.read({filePath: 'short', offset: 10})).toMatchObject({totalLines: 1, ranges: [], nextOffset: null});
  });

  it.each(['../outside', '/absolute', 'C:/outside', 'a\\b', 'a/../b', 'a/./b', 'a\0b'])('rejects unsafe model paths: %s', filePath => {
    expect(readInputSchema.safeParse({filePath}).success).toBe(false);
  });

  it.each([{filePath: 'a', workspaceRoot: '/other'}, {filePath: 'a', offset: 0}, {filePath: 'a', limit: 1001},
    {filePath: 'a', maxCharacters: 24001}, {filePath: 'a', query: ' '}, {filePath: 'a', filter: 'true'}])('rejects unsupported arguments (case %#)', input => {
    expect(readInputSchema.safeParse(input).success).toBe(false);
  });

  it('also validates direct service callers', async () => {
    await expect(createReadService({workspaceRoot: root}).read({filePath: '../outside'})).rejects.toMatchObject({code: 'invalid_input'});
    expect(() => createReadService({workspaceRoot: ' '})).toThrow('workspace root');
  });

  it('rejects file and directory symlink escapes but permits aliases inside the workspace', async () => {
    await writeFile(join(directory, 'secret.txt'), 'PRIVATE');
    await symlink(join(directory, 'secret.txt'), join(root, 'escape'));
    await symlink(directory, join(root, 'outside'));
    const service = createReadService({workspaceRoot: root});
    await expect(service.read({filePath: 'escape'})).rejects.toMatchObject({code: 'permission_denied'});
    await expect(service.read({filePath: 'outside/secret.txt'})).rejects.toMatchObject({code: 'permission_denied'});
    await writeFile(join(root, 'source'), 'source text');
    await symlink(join(root, 'source'), join(root, 'alias'));
    expect(await service.read({filePath: 'alias'})).toMatchObject({ranges: [{text: 'source text'}]});
  });

  it('rejects directories, binary bytes, malformed UTF-8, and oversized files', async () => {
    const service = createReadService({workspaceRoot: root});
    await mkdir(join(root, 'folder'));
    await expect(service.read({filePath: 'folder'})).rejects.toMatchObject({code: 'unsupported_content'});
    await writeFile(join(root, 'binary'), Buffer.from([0, 1, 2]));
    await expect(service.read({filePath: 'binary'})).rejects.toMatchObject({code: 'unsupported_content'});
    await writeFile(join(root, 'bad-utf8'), Buffer.from([0xff]));
    await expect(service.read({filePath: 'bad-utf8'})).rejects.toMatchObject({code: 'unsupported_content'});
    await writeFile(join(root, 'large'), Buffer.alloc(MAX_FILE_BYTES + 1, 'a'));
    await expect(service.read({filePath: 'large'})).rejects.toMatchObject({code: 'source_too_large'});
  });

  it('bounds characters and serialized output without splitting Unicode pairs', async () => {
    await writeFile(join(root, 'unicode'), '🙂'.repeat(20000));
    const output = await createReadService({workspaceRoot: root}).read({filePath: 'unicode', maxCharacters: 3});
    expect(output.ranges[0]?.text).toBe('🙂');
    expect(output.truncation.lineTruncated).toBe(true);
    await writeFile(join(root, 'escaped'), '\u0001'.repeat(30000));
    const escaped = await createReadService({workspaceRoot: root}).read({filePath: 'escaped'});
    expect(Buffer.byteLength(JSON.stringify(escaped), 'utf8')).toBeLessThan(60000);
    expect(escaped.truncation.lineTruncated).toBe(true);
  });

  it('maps failures into sanitized tool errors and honors cancellation', async () => {
    const service = createReadService({workspaceRoot: root});
    const read = createReadTool(service, createToolExecutor());
    const missing = await requireValue(read.execute)({filePath: 'missing'}, execution());
    expect(missing).toMatchObject({status: 'error', error: {code: 'not_found'}});
    expect(JSON.stringify(missing)).not.toContain(root);
    expect(await requireValue(read.execute)({filePath: 'missing'}, {...execution(), abortSignal: AbortSignal.abort()}))
      .toMatchObject({status: 'error', error: {code: 'cancelled'}});
  });

  it('shares the per-turn execution budget with navigation', async () => {
    await writeFile(join(root, 'file'), 'text');
    const execute = createToolExecutor();
    const tools = createNavigationTools({getStatus: () => ({lifecycle: 'unopened', graph: null})} as NavigationGraphService, execute);
    const read = createReadTool(createReadService({workspaceRoot: root}), execute);
    for (let position = 0; position < 6; position++) {
      await requireValue(tools.graph.execute)({}, execution(`graph-${position}`));
      await requireValue(read.execute)({filePath: 'file'}, execution(`read-${position}`));
    }
    expect(await requireValue(read.execute)({filePath: 'file'}, execution('extra'))).toMatchObject({status: 'error', error: {code: 'tool_limit'}});
  });
});
