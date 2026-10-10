import {createHash} from 'node:crypto';
import {chmod, link, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createApplyPatchService, createApplyPatchTool, createToolExecutor, type PatchApprover} from '../../../src/index.js';

let directory: string;
let outside: string;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const patch = (...sections: string[]) => ['*** Begin Patch', ...sections, '*** End Patch'].join('\n');
const update = (filePath = 'file.ts') => patch(`*** Update File: ${filePath}`, '@@', '-old', '+new');
function setup(approve: PatchApprover = async () => true) {
  const approval = vi.fn<PatchApprover>(approve);
  return {approval, service: createApplyPatchService({workspaceRoot: directory, approve: approval})};
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'codeyantram-patch-'));
  outside = await mkdtemp(join(tmpdir(), 'codeyantram-patch-outside-'));
});
afterEach(async () => {
  await rm(directory, {recursive: true, force: true});
  await rm(outside, {recursive: true, force: true});
});

describe('approved workspace patches', () => {
  it('adds, updates, and deletes only after exact patch approval', async () => {
    await writeFile(join(directory, 'file.ts'), 'old\n');
    await chmod(join(directory, 'file.ts'), 0o755);
    await writeFile(join(directory, 'remove.ts'), 'remove\n');
    const {service, approval} = setup();
    const patchText = patch('*** Add File: added.ts', '+added', '*** Update File: file.ts', '@@', '-old', '+new', '*** Delete File: remove.ts');
    const expectedHashes = {'file.ts': hash('old\n'), 'remove.ts': hash('remove\n')};
    const result = await service.apply({patchText, expectedHashes}, {objective: 'Update files'});
    expect(approval).toHaveBeenCalledTimes(1);
    expect(approval.mock.calls[0]?.[0]).toMatchObject({patchText, objective: 'Update files', changes: [
      {filePath: 'added.ts', action: 'add', beforeHash: null, afterHash: hash('added\n')},
      {filePath: 'file.ts', action: 'update', beforeHash: hash('old\n'), afterHash: hash('new\n')},
      {filePath: 'remove.ts', action: 'delete', beforeHash: hash('remove\n'), afterHash: null},
    ]});
    expect(approval.mock.calls[0]?.[0]).not.toHaveProperty('evaluation');
    expect(result).not.toHaveProperty('evaluation');
    expect(result.applied).toEqual([
      {filePath: 'added.ts', action: 'add', contentHash: hash('added\n')},
      {filePath: 'file.ts', action: 'update', contentHash: hash('new\n')},
      {filePath: 'remove.ts', action: 'delete', contentHash: null},
    ]);
    expect(await readFile(join(directory, 'file.ts'), 'utf8')).toBe('new\n');
    expect((await stat(join(directory, 'file.ts'))).mode & 0o777).toBe(0o755);
    expect(await readdir(directory)).toEqual(['added.ts', 'file.ts']);
  });

  it('denial leaves all files and directories unchanged', async () => {
    await writeFile(join(directory, 'file.ts'), 'old\n');
    const {service} = setup(async () => false);
    await expect(service.apply({patchText: update(), expectedHashes: {'file.ts': hash('old\n')}})).rejects.toMatchObject({code: 'permission_denied'});
    expect(await readFile(join(directory, 'file.ts'), 'utf8')).toBe('old\n');
    expect(await readdir(directory)).toEqual(['file.ts']);
  });

  it('does not let approval callback mutation rewrite the approved plan', async () => {
    const {service} = setup(async request => {
      request.patchText = patch('*** Add File: wrong.ts', '+wrong');
      const change = request.changes[0];
      if (change !== undefined) change.filePath = 'wrong.ts';
      return true;
    });
    await service.apply({patchText: patch('*** Add File: correct.ts', '+correct'), expectedHashes: {}});
    expect(await readdir(directory)).toEqual(['correct.ts']);
  });

  it('rechecks every target after approval before modifying any target', async () => {
    await writeFile(join(directory, 'file.ts'), 'old\n');
    const {service} = setup(async () => {await writeFile(join(directory, 'file.ts'), 'external\n'); return true;});
    const patchText = patch('*** Add File: added.ts', '+added', '*** Update File: file.ts', '@@', '-old', '+new');
    await expect(service.apply({patchText, expectedHashes: {'file.ts': hash('old\n')}})).rejects.toMatchObject({code: 'stale_reference'});
    expect(await readdir(directory)).toEqual(['file.ts']);
    expect(await readFile(join(directory, 'file.ts'), 'utf8')).toBe('external\n');
  });

  it('serializes competing patches rather than overwriting a previous tool change', async () => {
    await writeFile(join(directory, 'file.ts'), 'old\n');
    const {service, approval} = setup();
    const input = {patchText: update(), expectedHashes: {'file.ts': hash('old\n')}};
    const results = await Promise.allSettled([service.apply(input), service.apply(input)]);
    expect(results[0]?.status).toBe('fulfilled');
    expect(results[1]).toMatchObject({status: 'rejected', reason: {code: 'stale_reference'}});
    expect(approval).toHaveBeenCalledTimes(1);
  });

  it('cancels approval without writing and releases the queue', async () => {
    const controller = new AbortController();
    const {service, approval} = setup(async () => {
      controller.abort(new Error('stop'));
      return true;
    });
    await expect(service.apply({patchText: patch('*** Add File: file.ts', '+new'), expectedHashes: {}},
      {abortSignal: controller.signal})).rejects.toThrow('stop');
    expect(approval).toHaveBeenCalledTimes(1);
    const next = setup();
    await next.service.apply({patchText: patch('*** Add File: other.ts', '+other'), expectedHashes: {}});
    expect(await readdir(directory)).toEqual(['other.ts']);
  });

  it('sanitizes host callback errors and shares the executor budget', async () => {
    const {service} = setup(async () => {throw new Error('PRIVATE KEY');});
    const execute = createToolExecutor();
    const input = {patchText: patch('*** Add File: file.ts', '+new'), expectedHashes: {}};
    const tool = createApplyPatchTool(service, execute);
    const result = await tool.execute?.(input, {toolCallId: 'patch', messages: [], context: {}});
    expect(result).toMatchObject({status: 'error', error: {code: 'execution_failed'}});
    expect(JSON.stringify(result)).not.toContain('PRIVATE KEY');
    for (let position = 1; position < 12; position++) await execute('glob', `${position}`, undefined, async () => ({}));
    expect(await execute('apply_patch', 'over', undefined, async () => ({}))).toMatchObject({error: {code: 'tool_limit'}});
  });

  it('rejects removed evaluation controls before requesting approval', async () => {
    const {service, approval} = setup();
    const input = {patchText: patch('*** Add File: file.ts', '+new'), expectedHashes: {}, evaluate: false};
    await expect(service.apply(input)).rejects.toMatchObject({code: 'invalid_input'});
    expect(approval).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });
});

describe('patch boundaries', () => {
  it.each(['../outside.ts', '/outside.ts', '.git/config', '.CoDeX/settings', 'nested/.aws/credentials'])('rejects unsafe path %s', async filePath => {
    const {service, approval} = setup();
    await expect(service.apply({patchText: patch(`*** Add File: ${filePath}`, '+new'), expectedHashes: {}})).rejects.toBeInstanceOf(Error);
    expect(approval).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });

  it('rejects symlink parents, symlink files, and hard-linked files', async () => {
    await writeFile(join(outside, 'file.ts'), 'old\n');
    await symlink(outside, join(directory, 'linked'));
    await symlink(join(outside, 'file.ts'), join(directory, 'file.ts'));
    await link(join(outside, 'file.ts'), join(directory, 'hard.ts'));
    const {service, approval} = setup();
    for (const filePath of ['linked/file.ts', 'file.ts', 'hard.ts']) {
      await expect(service.apply({patchText: update(filePath), expectedHashes: {[filePath]: hash('old\n')}})).rejects.toMatchObject({code: 'permission_denied'});
    }
    expect(approval).not.toHaveBeenCalled();
    expect(await readFile(join(outside, 'file.ts'), 'utf8')).toBe('old\n');
  });

  it('rejects wrong hashes, missing hashes, extra hashes, and absent targets', async () => {
    await writeFile(join(directory, 'file.ts'), 'old\n');
    const {service, approval} = setup();
    const hashCases: Record<string, string>[] = [{}, {'file.ts': hash('wrong')}, {'file.ts': hash('old\n'), 'other.ts': hash('other')}];
    for (const expectedHashes of hashCases) {
      await expect(service.apply({patchText: update(), expectedHashes})).rejects.toBeInstanceOf(Error);
    }
    await expect(service.apply({patchText: update('missing.ts'), expectedHashes: {'missing.ts': hash('old\n')}})).rejects.toMatchObject({code: 'not_found'});
    expect(approval).not.toHaveBeenCalled();
  });

  it('rejects add overwrites, absent parents, malformed bodies, duplicate paths, and moves', async () => {
    await writeFile(join(directory, 'file.ts'), 'old\n');
    const {service, approval} = setup();
    const bad = [patch('*** Add File: file.ts', '+overwrite'), patch('*** Add File: missing/new.ts', '+new'),
      patch('*** Add File: added.ts', 'unprefixed'), patch('*** Delete File: file.ts', '-old'),
      patch('*** Add File: same.ts', '+one', '*** Add File: same.ts', '+two'),
      patch('*** Update File: file.ts', '*** Move to: moved.ts', '@@', '-old', '+new')];
    for (const patchText of bad) await expect(service.apply({patchText, expectedHashes: {}})).rejects.toBeInstanceOf(Error);
    expect(approval).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual(['file.ts']);
  });

  it('rejects binary, malformed UTF-8, and files exceeding the byte budget', async () => {
    const {service, approval} = setup();
    for (const bytes of [Buffer.from([0]), Buffer.from([0xff]), Buffer.alloc(1_048_577, 'a')]) {
      await writeFile(join(directory, 'file.ts'), bytes);
      await expect(service.apply({patchText: update(), expectedHashes: {'file.ts': createHash('sha256').update(bytes).digest('hex')}})).rejects.toBeInstanceOf(Error);
    }
    expect(approval).not.toHaveBeenCalled();
  });

  it('supports existing nested directories, never creates them before approval', async () => {
    await mkdir(join(directory, 'src'));
    const {service} = setup();
    await service.apply({patchText: patch('*** Add File: src/file.ts', '+new'), expectedHashes: {}});
    expect(await readFile(join(directory, 'src/file.ts'), 'utf8')).toBe('new\n');
  });
});
