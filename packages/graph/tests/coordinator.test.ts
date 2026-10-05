import {describe, expect, it, vi} from 'vitest';
import {GraphCoordinator, type CoordinatedGraph, type GraphReader, type GraphSyncReport} from '../src/index.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

const ready = {indexState: 'complete', needsReindex: false, lastIndexedAt: 1, fileCount: 2, nodeCount: 4, edgeCount: 3} as const;
const indexReport = {success: true, state: 'complete', filesIndexed: 2, filesSkipped: 0, filesErrored: 0,
  nodesCreated: 4, edgesCreated: 3, errors: [], durationMs: 1} as const;
const syncReport: GraphSyncReport = {success: true, filesChecked: 2, filesAdded: 0, filesModified: 0,
  filesRemoved: 0, nodesUpdated: 0, durationMs: 1, changedFilePaths: [], failedFilePaths: []};

function setup(options?: {cleanupTimeoutMs: number}) {
  const graph = {
    storage: {workspaceRoot: '/project', workspaceId: 'test', databasePath: '/global/codegraph.db', directory: '/global', lockPath: '/global/codegraph.lock'},
    getStatus: vi.fn().mockReturnValue(ready),
    index: vi.fn().mockResolvedValue(indexReport), sync: vi.fn().mockResolvedValue(syncReport),
    search: vi.fn().mockReturnValue([]), getSymbol: vi.fn().mockReturnValue(null),
    explore: vi.fn(),
    find: vi.fn(), inspect: vi.fn(), trace: vi.fn(),
    getSource: vi.fn().mockResolvedValue(null), getCallers: vi.fn().mockReturnValue([]), getCallees: vi.fn().mockReturnValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {graph, coordinator: new GraphCoordinator(graph as CoordinatedGraph, options)};
}

describe('workspace graph coordinator', () => {
  it.each([null, 'partial', 'failed', 'indexing', 'outdated'])('establishes a baseline for state %s before navigation', async state => {
    const {graph, coordinator} = setup();
    graph.getStatus.mockReturnValueOnce({...ready,
      indexState: state === 'outdated' ? 'complete' : state, needsReindex: state === 'outdated'});
    const result = await coordinator.query(reader => reader.search('symbol'));
    expect(graph.index).toHaveBeenCalledOnce();
    expect(graph.sync).not.toHaveBeenCalled();
    expect(result).toMatchObject({value: [], freshness: {revision: 1}});
    expect(coordinator.getStatus()).toMatchObject({readiness: 'ready', operation: 'idle', pendingOperations: 0, index: ready});
    await coordinator.close();
  });

  it('keeps sync and the whole asynchronous query in one slot before the next edit', async () => {
    const {graph, coordinator} = setup();
    const syncing = deferred<GraphSyncReport>();
    const syncEntered = deferred<void>();
    const readEntered = deferred<void>();
    const readDone = deferred<void>();
    graph.sync.mockImplementationOnce(() => {syncEntered.resolve(); return syncing.promise;});
    const read = coordinator.query(async reader => {
      readEntered.resolve(); await readDone.promise; return reader.search('symbol');
    });
    const write = vi.fn(({markChanged}) => {markChanged('src/main.ts'); return 'edited';});
    const edit = coordinator.edit(write);
    await syncEntered.promise;
    expect(graph.search).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(coordinator.getStatus()).toMatchObject({operation: 'synchronizing', pendingOperations: 2});
    syncing.resolve(syncReport);
    await readEntered.promise;
    expect(write).not.toHaveBeenCalled();
    readDone.resolve();
    await read;
    expect(await edit).toMatchObject({mutation: {success: true, value: 'edited', changedPaths: ['src/main.ts']}, graph: {state: 'synchronized'}});
    expect(graph.sync).toHaveBeenCalledTimes(2);
    expect(coordinator.getStatus().pendingPaths).toEqual([]);
    await coordinator.close();
  });

  it('blocks navigation on returned index diagnostics and allows initialization to recover', async () => {
    const {graph, coordinator} = setup();
    graph.getStatus.mockReturnValueOnce({...ready, indexState: null});
    graph.index.mockResolvedValueOnce({...indexReport, success: false, state: 'partial', filesErrored: 1,
      errors: [{severity: 'error', message: 'Read failed', filePath: 'bad.ts'}]});
    await expect(coordinator.query(reader => reader.search('symbol'))).rejects.toMatchObject({code: 'index_failed', report: {filesErrored: 1}});
    expect(graph.search).not.toHaveBeenCalled();
    expect(coordinator.getStatus()).toMatchObject({readiness: 'error', needsFullScan: true});
    await coordinator.initialize();
    expect(coordinator.getStatus()).toMatchObject({readiness: 'ready', lastError: null});
    await coordinator.close();
  });

  it('returns write success separately from sync failure, retains dirty paths, and never replays writes', async () => {
    const {graph, coordinator} = setup();
    graph.sync.mockResolvedValue({...syncReport, success: false, failedFilePaths: ['main.ts']});
    const write = vi.fn(({markChanged}) => {markChanged('main.ts'); return 'saved';});
    expect(await coordinator.edit(write)).toMatchObject({mutation: {success: true, value: 'saved', changedPaths: ['main.ts']},
      graph: {state: 'failed', error: {code: 'sync_failed', report: {failedFilePaths: ['main.ts']}}}});
    expect(coordinator.getStatus()).toMatchObject({readiness: 'error', pendingPaths: ['main.ts'], needsFullScan: true});
    await expect(coordinator.query(reader => reader.search('symbol'))).rejects.toMatchObject({code: 'sync_failed'});
    expect(graph.search).not.toHaveBeenCalled();
    graph.sync.mockResolvedValue(syncReport);
    await coordinator.query(reader => reader.search('symbol'));
    expect(write).toHaveBeenCalledOnce();
    expect(coordinator.getStatus()).toMatchObject({readiness: 'ready', pendingPaths: [], needsFullScan: false});
    await coordinator.close();
  });

  it('preserves both a partial write error and thrown sync error', async () => {
    const {graph, coordinator} = setup();
    const mutationError = new Error('second file write failed');
    const syncError = new Error('database locked');
    graph.sync.mockRejectedValueOnce(syncError);
    const result = await coordinator.edit(({markChanged}) => {markChanged('first.ts'); throw mutationError;});
    expect(result.mutation).toMatchObject({success: false, error: mutationError, changedPaths: ['first.ts']});
    expect(result.graph).toMatchObject({state: 'failed', error: {cause: syncError}});
    await coordinator.close();
  });

  it('reconciles writes after caller cancellation with an independent cleanup signal', async () => {
    const {graph, coordinator} = setup();
    const cancellation = new AbortController();
    const result = await coordinator.edit(({markChanged}) => {
      markChanged('changed.ts'); cancellation.abort(); return 'saved';
    }, {signal: cancellation.signal});
    expect(result).toMatchObject({mutation: {success: true, value: 'saved', changedPaths: ['changed.ts']}, graph: {state: 'synchronized'}});
    expect(graph.sync.mock.calls[0][0].signal).not.toBe(cancellation.signal);
    expect(graph.sync.mock.calls[0][0].signal.aborted).toBe(false);
    expect(coordinator.getStatus().readiness).toBe('ready');
    await coordinator.close();
  });

  it('preserves an interrupted partial mutation while still synchronizing its completed writes', async () => {
    const {coordinator} = setup();
    const cancellation = new AbortController();
    const result = await coordinator.edit(({markChanged, signal}) => {
      markChanged('first.ts'); cancellation.abort(); signal!.throwIfAborted();
    }, {signal: cancellation.signal});
    expect(result).toMatchObject({mutation: {success: false, changedPaths: ['first.ts']}, graph: {state: 'synchronized'}});
    await coordinator.close();
  });

  it('does not run a cancelled queued edit or sync a callback that made no writes', async () => {
    const {graph, coordinator} = setup();
    const gate = deferred<GraphSyncReport>();
    const entered = deferred<void>();
    graph.sync.mockImplementationOnce(() => {entered.resolve(); return gate.promise;});
    const initializing = coordinator.initialize();
    const controller = new AbortController();
    const write = vi.fn();
    const queued = coordinator.edit(write, {signal: controller.signal});
    const rejected = expect(queued).rejects.toThrow();
    await entered.promise;
    controller.abort(); gate.resolve(syncReport);
    await initializing; await rejected;
    expect(write).not.toHaveBeenCalled();
    const error = new Error('validation failed');
    expect(await coordinator.edit(() => {throw error;})).toEqual({mutation: {success: false, error, changedPaths: []}, graph: {state: 'unchanged'}});
    expect(graph.sync).toHaveBeenCalledOnce();
    await coordinator.close();
  });

  it('retains newer notifications for the same path arriving during sync and repeats reconciliation', async () => {
    const {graph, coordinator} = setup();
    coordinator.notifyChanges(['main.ts']);
    graph.sync.mockImplementationOnce(async () => {
      coordinator.notifyChanges(['main.ts', 'added.ts']);
      return syncReport;
    }).mockImplementationOnce(async () => {
      expect(coordinator.getStatus().pendingPaths).toEqual(['added.ts', 'main.ts']);
      return syncReport;
    });
    await coordinator.query(reader => reader.search('symbol'));
    expect(graph.sync).toHaveBeenCalledTimes(2);
    expect(coordinator.getStatus()).toMatchObject({readiness: 'ready', pendingPaths: [], freshness: {revision: 2}});
    await coordinator.close();
  });

  it('bounds retries for continuous external changes and keeps navigation blocked', async () => {
    const {graph, coordinator} = setup();
    graph.sync.mockImplementation(async () => {coordinator.notifyChanges(); return syncReport;});
    await expect(coordinator.query(reader => reader.search('symbol'))).rejects.toMatchObject({code: 'changes_during_sync'});
    expect(graph.sync).toHaveBeenCalledTimes(3);
    expect(graph.search).not.toHaveBeenCalled();
    expect(coordinator.getStatus()).toMatchObject({readiness: 'error', needsFullScan: true});
    await coordinator.close();
  });

  it('rejects a query result if an external change is reported during its callback', async () => {
    const {coordinator} = setup();
    await expect(coordinator.query(() => {coordinator.notifyChanges(['external.ts']); return 'old result';}))
      .rejects.toMatchObject({code: 'changes_during_sync'});
    expect(coordinator.getStatus()).toMatchObject({readiness: 'dirty', pendingPaths: ['external.ts']});
    await coordinator.close();
  });

  it('blocks a notification arriving in the gap between completed sync and the query callback', async () => {
    const {graph, coordinator} = setup();
    graph.getStatus.mockReturnValueOnce(ready).mockImplementationOnce(() => {
      queueMicrotask(() => coordinator.notifyChanges(['late.ts']));
      return ready;
    });
    await expect(coordinator.query(reader => reader.search('symbol'))).rejects.toMatchObject({code: 'changes_during_sync'});
    expect(graph.search).not.toHaveBeenCalled();
    expect(coordinator.getStatus()).toMatchObject({readiness: 'dirty', pendingPaths: ['late.ts']});
    await coordinator.close();
  });

  it('drains source reads even if the callback forgets to await them and expires its reader', async () => {
    const {graph, coordinator} = setup();
    const source = deferred<string | null>();
    const entered = deferred<void>();
    graph.getSource.mockImplementation(() => {entered.resolve(); return source.promise;});
    let reader!: GraphReader;
    const reading = coordinator.query(current => {reader = current; void current.getSource('id'); return 'result';});
    const edit = vi.fn(() => 'no writes');
    const editing = coordinator.edit(edit);
    await entered.promise;
    expect(edit).not.toHaveBeenCalled();
    source.resolve('code');
    await reading; await editing;
    expect(() => reader.search('late')).toThrow('inside their query');
    await coordinator.close();
  });

  it.each(['find', 'inspect', 'trace'] as const)('drains asynchronous %s reads and expires the navigation reader', async method => {
    const {graph, coordinator} = setup();
    const result = deferred<unknown>(), entered = deferred<void>();
    graph[method].mockImplementation(() => {entered.resolve(); return result.promise;});
    let reader!: GraphReader;
    const invoke = (current: GraphReader) => {
      if (method === 'find') return current.find('greet');
      if (method === 'inspect') return current.inspect({filePath: 'src/helper.ts'});
      return current.trace({workspaceId: 'a'.repeat(64), symbolId: 'id', filePath: 'src/helper.ts', contentHash: 'b'.repeat(64)}, {direction: 'callers'});
    };
    const reading = coordinator.query(current => {reader = current; void invoke(current); return 'finished callback';});
    const write = vi.fn(() => 'no changes');
    const writing = coordinator.edit(write);
    await entered.promise;
    expect(write).not.toHaveBeenCalled();
    result.resolve({}); await reading; await writing;
    expect(() => invoke(reader)).toThrow('inside their query');
    await coordinator.close();
  });

  it('keeps timed-out cleanup in its slot until the SDK actually stops, including during close', async () => {
    vi.useFakeTimers();
    const {graph, coordinator} = setup({cleanupTimeoutMs: 50});
    const entered = deferred<void>();
    const gate = deferred<GraphSyncReport>();
    let signal!: AbortSignal;
    graph.sync.mockImplementationOnce(options => {signal = options.signal; entered.resolve(); return gate.promise;});
    try {
      const editing = coordinator.edit(({markChanged}) => {markChanged('written.ts'); return 'saved';});
      const next = coordinator.query(reader => reader.search('symbol'));
      await entered.promise;
      const closing = coordinator.close();
      await vi.advanceTimersByTimeAsync(51);
      expect(signal.aborted).toBe(true);
      expect(graph.search).not.toHaveBeenCalled();
      expect(graph.close).not.toHaveBeenCalled();
      gate.resolve(syncReport);
      expect(await editing).toMatchObject({mutation: {success: true, value: 'saved'}, graph: {state: 'failed', error: {code: 'cleanup_timeout'}}});
      await next; await closing;
      expect(graph.close).toHaveBeenCalledOnce();
    } finally {vi.useRealTimers();}
  });

  it('drains already admitted operations on close and rejects new admission and notifications', async () => {
    const {graph, coordinator} = setup();
    const first = coordinator.initialize();
    const second = coordinator.query(reader => reader.search('symbol'));
    const closing = coordinator.close();
    expect(coordinator.close()).toBe(closing);
    await expect(coordinator.initialize()).rejects.toMatchObject({code: 'closed'});
    expect(() => coordinator.notifyChanges(['late.ts'])).toThrow('closing or closed');
    expect(graph.close).not.toHaveBeenCalled();
    await first; await second; await closing;
    expect(graph.close).toHaveBeenCalledOnce();
    expect(coordinator.getStatus()).toMatchObject({operation: 'closed', pendingOperations: 0});
  });

  it('normalizes changed paths and rejects paths outside the workspace without losing recorded changes', async () => {
    const {coordinator} = setup();
    coordinator.notifyChanges(['/project/src/../main.ts']);
    expect(coordinator.getStatus().pendingPaths).toEqual(['main.ts']);
    expect(() => coordinator.notifyChanges(['../outside.ts'])).toThrow('inside');
    expect(() => coordinator.notifyChanges([' '])).toThrow('required');
    expect(() => coordinator.notifyChanges(['/project'])).toThrow('inside');
    expect(coordinator.getStatus().pendingPaths).toEqual(['main.ts']);
    await coordinator.close();
  });
});
