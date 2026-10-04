import {describe, expect, it, vi} from 'vitest';
import {GraphCoordinator, type CoordinatedGraph, type GraphCoordinatorLease} from '@codeyantram/graph';
import {createApp, WorkspaceGraphService} from '../../src/index.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => {resolve = yes;});
  return {promise, resolve};
}
const report = {success: true, filesChecked: 1, filesAdded: 0, filesModified: 0, filesRemoved: 0,
  nodesUpdated: 0, durationMs: 1, changedFilePaths: [], failedFilePaths: []};
function setup() {
  const graph = {
    storage: {workspaceRoot: '/project'},
    getStatus: vi.fn().mockReturnValue({indexState: 'complete', needsReindex: false, lastIndexedAt: 1, fileCount: 1, nodeCount: 1, edgeCount: 0}),
    sync: vi.fn().mockResolvedValue(report), index: vi.fn(),
    search: vi.fn().mockReturnValue([]), close: vi.fn().mockResolvedValue(undefined),
  };
  const coordinator = new GraphCoordinator(graph as unknown as CoordinatedGraph);
  const release = vi.fn(() => coordinator.close());
  const acquire = vi.fn().mockResolvedValue({coordinator, release});
  const service = new WorkspaceGraphService('/project', acquire);
  return {service, coordinator, graph, acquire, release};
}

describe('server-owned workspace graph', () => {
  it('constructs and closes an app without acquiring or initializing its graph', async () => {
    const acquire = vi.fn();
    const app = createApp({workspaceRoot: '/project', acquireGraphCoordinator: acquire});
    expect(app.workspaceGraph.getStatus()).toEqual({lifecycle: 'unopened', workspaceRoot: '/project', graph: null});
    expect(app.locals.workspaceGraph).toBe(app.workspaceGraph);
    await app.close();
    expect(acquire).not.toHaveBeenCalled();
    expect(app.workspaceGraph.getStatus().lifecycle).toBe('closed');
  });

  it('requires a host-selected root only when graph work is requested', async () => {
    const acquire = vi.fn();
    const service = new WorkspaceGraphService(undefined, acquire);
    await expect(service.initialize()).rejects.toThrow('workspace root');
    expect(acquire).not.toHaveBeenCalled();
    await service.close();
  });

  it('deduplicates concurrent acquisitions, retains the lease, and shares the queue across request types', async () => {
    const {service, coordinator, graph, acquire, release} = setup();
    const gate = deferred<GraphCoordinatorLease>();
    const started = deferred<void>();
    acquire.mockImplementationOnce(() => {started.resolve(); return gate.promise;});
    const first = service.initialize();
    const second = service.query(reader => reader.search('symbol'));
    await started.promise;
    expect(service.getStatus().lifecycle).toBe('opening');
    expect(acquire).toHaveBeenCalledExactlyOnceWith('/project');
    gate.resolve({coordinator, release});
    await first; await second;
    await service.initialize();
    expect(graph.sync).toHaveBeenCalledTimes(3);
    expect(graph.search).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
    expect(service.getStatus()).toMatchObject({lifecycle: 'open', graph: {readiness: 'ready'}});
    const closing = service.close();
    expect(service.close()).toBe(closing);
    await closing;
    expect(release).toHaveBeenCalledOnce();
  });

  it('retries failed acquisition without poisoning later graph requests', async () => {
    const {service, acquire} = setup();
    acquire.mockRejectedValueOnce(new Error('database locked'));
    await expect(service.initialize()).rejects.toThrow('database locked');
    expect(service.getStatus().lifecycle).toBe('unopened');
    await service.initialize();
    expect(acquire).toHaveBeenCalledTimes(2);
    await service.close();
  });

  it('cancellation does not release the server lease and a later request can recover', async () => {
    const {service, graph, acquire, release} = setup();
    const controller = new AbortController();
    graph.sync.mockImplementationOnce(async () => {controller.abort(); return report;});
    await expect(service.initialize({signal: controller.signal})).rejects.toThrow();
    expect(release).not.toHaveBeenCalled();
    await service.initialize();
    expect(acquire).toHaveBeenCalledOnce();
    expect(service.getStatus().graph?.readiness).toBe('ready');
    await service.close();
  });

  it('drains an acquisition completing after shutdown and releases it without running operations', async () => {
    const {service, coordinator, acquire, release, graph} = setup();
    const gate = deferred<GraphCoordinatorLease>();
    const started = deferred<void>();
    acquire.mockImplementationOnce(() => {started.resolve(); return gate.promise;});
    const operation = service.initialize();
    const rejected = expect(operation).rejects.toThrow();
    await started.promise;
    const closing = service.close();
    expect(service.getStatus().lifecycle).toBe('closing');
    await expect(service.query(() => [])).rejects.toThrow('closing or closed');
    expect(release).not.toHaveBeenCalled();
    gate.resolve({coordinator, release});
    await rejected; await closing;
    expect(graph.sync).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it('cancels active initialization but waits for the SDK to settle before releasing SQLite', async () => {
    const {service, graph, release} = setup();
    const started = deferred<void>();
    const gate = deferred<typeof report>();
    let signal!: AbortSignal;
    graph.sync.mockImplementationOnce(options => {signal = options.signal; started.resolve(); return gate.promise;});
    const operation = service.initialize();
    const rejected = expect(operation).rejects.toThrow();
    await started.promise;
    const closing = service.close();
    expect(signal.aborted).toBe(true);
    expect(release).not.toHaveBeenCalled();
    gate.resolve(report);
    await rejected; await closing;
    expect(release).toHaveBeenCalledOnce();
  });

  it('allows independent edit cleanup to finish during server shutdown before releasing the lease', async () => {
    const {service, graph, release} = setup();
    const started = deferred<void>();
    const gate = deferred<typeof report>();
    let signal!: AbortSignal;
    graph.sync.mockImplementationOnce(options => {signal = options.signal; started.resolve(); return gate.promise;});
    const operation = service.edit(({markChanged}) => {markChanged('saved.ts'); return 'saved';});
    await started.promise;
    const closing = service.close();
    expect(signal.aborted).toBe(false);
    expect(release).not.toHaveBeenCalled();
    gate.resolve(report);
    expect(await operation).toMatchObject({mutation: {success: true, value: 'saved'}, graph: {state: 'synchronized'}});
    await closing;
    expect(release).toHaveBeenCalledOnce();
    expect(graph.close).toHaveBeenCalledOnce();
  });

  it('reports release failures after draining and never releases twice', async () => {
    const {service, release} = setup();
    await service.initialize();
    release.mockRejectedValueOnce(new Error('close failed'));
    const closing = service.close();
    await expect(closing).rejects.toThrow('close failed');
    expect(service.close()).toBe(closing);
    expect(service.getStatus().lifecycle).toBe('closed');
    expect(release).toHaveBeenCalledOnce();
  });
});
