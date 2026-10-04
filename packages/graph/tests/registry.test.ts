import {mkdtemp, mkdir, realpath, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {WorkspaceGraphRegistry, type CoordinatedGraph, type GraphCoordinatorLease} from '../src/index.js';

let directory: string;
let root: string;
let leases: GraphCoordinatorLease[];
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'codeyantram-graph-registry-'));
  root = path.join(directory, 'project'); await mkdir(root); leases = [];
});
afterEach(async () => {
  await Promise.all(leases.map(lease => lease.release()));
  await rm(directory, {recursive: true, force: true});
});
function backend(workspaceRoot: string) {
  return {storage: {workspaceRoot}, close: vi.fn().mockResolvedValue(undefined)} as unknown as CoordinatedGraph;
}
async function acquire(registry: WorkspaceGraphRegistry, workspace = root) {
  const lease = await registry.acquire(workspace); leases.push(lease); return lease;
}

describe('graph coordinator leases', () => {
  it('shares one coordinator for concurrent acquisitions and symlink aliases, closing only on last release', async () => {
    const alias = path.join(directory, 'alias'); await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const graph = backend(await realpath(root));
    const open = vi.fn().mockResolvedValue(graph);
    const registry = new WorkspaceGraphRegistry(open);
    const [first, second] = await Promise.all([acquire(registry), acquire(registry, alias)]);
    expect(first.coordinator).toBe(second.coordinator);
    expect(open).toHaveBeenCalledExactlyOnceWith(await realpath(root));
    const releasing = first.release(); await releasing;
    expect(first.release()).toBe(releasing);
    expect(graph.close).not.toHaveBeenCalled();
    await second.release();
    expect(graph.close).toHaveBeenCalledOnce();
    const next = await acquire(registry);
    expect(next.coordinator).not.toBe(first.coordinator);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('keeps separate workspaces independent', async () => {
    const other = path.join(directory, 'other'); await mkdir(other);
    const open = vi.fn(async (root: string) => backend(root));
    const registry = new WorkspaceGraphRegistry(open);
    const [first, second] = await Promise.all([acquire(registry), acquire(registry, other)]);
    expect(first.coordinator).not.toBe(second.coordinator);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('allows a new attempt after opening fails', async () => {
    const open = vi.fn().mockRejectedValueOnce(new Error('locked')).mockResolvedValue(backend(root));
    const registry = new WorkspaceGraphRegistry(open);
    await expect(acquire(registry)).rejects.toThrow('locked');
    await acquire(registry);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('waits for the previous coordinator to close before reopening', async () => {
    let finish!: () => void;
    const graph = backend(root);
    vi.mocked(graph.close).mockReturnValueOnce(new Promise<void>(resolve => {finish = resolve;}));
    const open = vi.fn().mockResolvedValue(graph);
    const registry = new WorkspaceGraphRegistry(open);
    const first = await acquire(registry);
    const closing = first.release();
    await vi.waitFor(() => expect(graph.close).toHaveBeenCalledOnce());
    const reacquiring = acquire(registry);
    expect(open).toHaveBeenCalledOnce();
    finish(); await closing;
    const next = await reacquiring;
    expect(open).toHaveBeenCalledTimes(2);
    expect(next.coordinator).not.toBe(first.coordinator);
  });
});
