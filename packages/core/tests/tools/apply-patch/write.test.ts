import {createHash} from 'node:crypto';
import {mkdtemp, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import type * as FileSystem from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createApplyPatchService} from '../../../src/index.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof FileSystem>();
  return {...actual, rename: vi.fn<typeof actual.rename>(actual.rename)};
});

let directory: string;
beforeEach(async () => {directory = await mkdtemp(join(tmpdir(), 'codeyantram-patch-write-'));});
afterEach(async () => {
  vi.mocked(rename).mockReset();
  await rm(directory, {recursive: true, force: true});
});

describe('patch write failures', () => {
  it('reports already applied paths without pretending a multi-file failure rolled back', async () => {
    const actual = await vi.importActual<typeof FileSystem>('node:fs/promises');
    vi.mocked(rename).mockImplementationOnce(actual.rename).mockRejectedValueOnce(new Error('PRIVATE HOST PATH'));
    await writeFile(join(directory, 'a.ts'), 'old\n');
    await writeFile(join(directory, 'b.ts'), 'old\n');
    const service = createApplyPatchService({workspaceRoot: directory, approve: async () => true});
    const oldHash = createHash('sha256').update('old\n').digest('hex');
    const patchText = ['*** Begin Patch', '*** Update File: a.ts', '@@', '-old', '+new',
      '*** Update File: b.ts', '@@', '-old', '+new', '*** End Patch'].join('\n');
    await expect(service.apply({patchText, expectedHashes: {'a.ts': oldHash, 'b.ts': oldHash}})).rejects.toMatchObject({
      code: 'execution_failed', message: 'Patch partially applied to a.ts. Re-read all targets; do not replay the original patch.',
    });
    expect(await readFile(join(directory, 'a.ts'), 'utf8')).toBe('new\n');
    expect(await readFile(join(directory, 'b.ts'), 'utf8')).toBe('old\n');
    expect(await readdir(directory)).toEqual(['a.ts', 'b.ts']);
  });
});
