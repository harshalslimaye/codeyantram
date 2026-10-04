import {beforeEach, describe, expect, it, vi} from 'vitest';
import {openWorkspaceGraph, type GraphIndexReport, type GraphProgress, type WorkspaceGraph} from '@codeyantram/graph';
import {initializeGraphForUI, runInit} from '../../src/lib/init.js';

vi.mock('@codeyantram/graph', () => ({openWorkspaceGraph: vi.fn()}));

const workspace = '/selected/project';
const databasePath = '/global/codeyantram/graphs/workspace/codegraph.db';
const ready = {indexState: 'complete', needsReindex: false, fileCount: 2, nodeCount: 4, edgeCount: 3, lastIndexedAt: 1} as const;
const report: GraphIndexReport = {
  success: true, state: 'complete', filesIndexed: 2, filesSkipped: 1, filesErrored: 0,
  nodesCreated: 4, edgesCreated: 3, errors: [], durationMs: 1,
};
let graph: {
  storage: {databasePath: string};
  getStatus: ReturnType<typeof vi.fn>;
  index: ReturnType<typeof vi.fn>;
  sync: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};
const makeOutput = () => ({write: vi.fn<(chunk: string) => boolean>(() => true)});
let stdout: ReturnType<typeof makeOutput>;
let stderr: ReturnType<typeof makeOutput>;

const text = (stream: typeof stdout) => stream.write.mock.calls.map(([chunk]) => String(chunk)).join('');

beforeEach(() => {
  graph = {
    storage: {databasePath},
    getStatus: vi.fn().mockReturnValue(ready).mockReturnValueOnce({...ready, indexState: null}),
    index: vi.fn().mockResolvedValue(report),
    sync: vi.fn().mockResolvedValue({success: true, filesAdded: 1, filesModified: 1, filesRemoved: 0, failedFilePaths: []}),
    close: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(openWorkspaceGraph).mockResolvedValue(graph as unknown as WorkspaceGraph);
  stdout = makeOutput();
  stderr = makeOutput();
});

describe('graph init command', () => {

  it('uses UI-owned cancellation and progress without adding process signal handlers', async () => {
    const before = process.listeners('SIGINT');
    const progress = vi.fn();
    const controller = new AbortController();
    graph.index.mockImplementation(async options => {
      expect(process.listeners('SIGINT')).toEqual(before);
      expect(options.signal.aborted).toBe(false);
      options.onProgress({phase: 'parsing', current: 1, total: 2});
      return report;
    });
    expect(await initializeGraphForUI(workspace, controller.signal, progress)).toBe('Graph ready: 2 files, 4 symbols, 3 relationships.');
    expect(progress).toHaveBeenCalledExactlyOnceWith('Indexing graph · parsing: 1/2');
    expect(graph.close).toHaveBeenCalledOnce();
    expect(process.listeners('SIGINT')).toEqual(before);
  });

  it('passes indexing failures back to the palette', async () => {
    graph.index.mockResolvedValue({...report, success: false, state: 'partial', filesErrored: 1,
      errors: [{severity: 'error', filePath: 'src/bad.ts', message: 'Could not read source.'}],
    });
    await expect(initializeGraphForUI(workspace, new AbortController().signal, vi.fn())).rejects.toThrow('src/bad.ts');
    expect(graph.close).toHaveBeenCalledOnce();
  });

  it('cancels UI initialization before opening if the signal is already aborted', async () => {
    await expect(initializeGraphForUI(workspace, AbortSignal.abort(), vi.fn())).rejects.toThrow();
    expect(openWorkspaceGraph).not.toHaveBeenCalled();
  });

  it('builds a baseline and reports storage, progress, coverage, and graph counts', async () => {
    graph.index.mockImplementation(async options => {
      options.onProgress({phase: 'scanning', current: 0, total: 2} satisfies GraphProgress);
      options.onProgress({phase: 'parsing', current: 1, total: 2} satisfies GraphProgress);
      return {...report, filesSkippedUnsupported: 3};
    });
    expect(await runInit(workspace, {stdout, stderr})).toBe(0);
    expect(openWorkspaceGraph).toHaveBeenCalledExactlyOnceWith(workspace);
    expect(graph.sync).not.toHaveBeenCalled();
    expect(graph.close).toHaveBeenCalledOnce();
    expect(text(stdout)).toContain(databasePath);
    expect(text(stdout)).toContain('scanning: 0/2');
    expect(text(stdout)).toContain('parsing: 1/2');
    expect(text(stdout)).toContain('Indexed 2 files; 1 skipped; 3 unsupported');
    expect(text(stdout)).toContain('Graph ready: 2 files, 4 symbols, 3 relationships');
    expect(stderr.write).not.toHaveBeenCalled();
  });

  it('syncs an existing complete graph on repeated init', async () => {
    graph.getStatus.mockReset().mockReturnValue(ready);
    expect(await runInit(workspace, {stdout, stderr})).toBe(0);
    expect(graph.index).not.toHaveBeenCalled();
    expect(graph.sync).toHaveBeenCalledOnce();
    expect(text(stdout)).toContain('Refreshing existing graph');
    expect(text(stdout)).toContain('Synced 1 added, 1 modified, 0 removed files');
  });

  it.each(['partial', 'failed', 'indexing', 'outdated'])('rebuilds a %s index', async state => {
    graph.getStatus.mockReset().mockReturnValue(ready).mockReturnValueOnce({
      ...ready, indexState: state === 'outdated' ? 'complete' : state, needsReindex: state === 'outdated',
    });
    expect(await runInit(workspace, {stdout, stderr})).toBe(0);
    expect(graph.index).toHaveBeenCalledOnce();
    expect(graph.sync).not.toHaveBeenCalled();
  });

  it('returns failure for an incomplete index, preserves diagnostics, and closes the graph', async () => {
    graph.index.mockResolvedValue({...report, success: false, state: 'partial', filesErrored: 1,
      errors: [{severity: 'error', filePath: 'src/bad.ts', message: 'Could not read source.'}],
    });
    expect(await runInit(workspace, {stdout, stderr})).toBe(1);
    expect(text(stderr)).toContain('src/bad.ts: Could not read source');
    expect(text(stderr)).toContain('state: partial');
    expect(text(stdout)).not.toContain('Graph ready');
    expect(graph.close).toHaveBeenCalledOnce();
  });

  it('returns failure when sync leaves changed files unindexed', async () => {
    graph.getStatus.mockReset().mockReturnValue(ready);
    graph.sync.mockResolvedValue({success: false, failedFilePaths: ['src/bad.ts']});
    expect(await runInit(workspace, {stdout, stderr})).toBe(1);
    expect(text(stderr)).toContain('Failed to index: src/bad.ts');
    expect(text(stdout)).not.toContain('Graph ready');
    expect(graph.close).toHaveBeenCalledOnce();
  });

  it.each(['opening', 'indexing', 'closing'])('reports %s errors with a nonzero exit code', async stage => {
    if (stage === 'opening') vi.mocked(openWorkspaceGraph).mockRejectedValue(new Error('Database locked.'));
    if (stage === 'indexing') graph.index.mockRejectedValue(new Error('Indexing failed.'));
    if (stage === 'closing') graph.close.mockRejectedValue(new Error('Close failed.'));
    expect(await runInit(workspace, {stdout, stderr})).toBe(1);
    expect(text(stderr)).toContain(stage === 'opening' ? 'Database locked' : stage === 'indexing' ? 'Indexing failed' : 'Close failed');
    expect(text(stdout)).not.toContain('Graph ready');
    if (stage !== 'opening') expect(graph.close).toHaveBeenCalledOnce();
  });

  it.each([['SIGINT', 130], ['SIGTERM', 143]] as const)('cancels on %s and removes signal handlers after draining', async (signal, code) => {
    const previous = process.listeners(signal);
    graph.index.mockImplementation(async options => {
      process.listeners(signal).find(listener => !previous.includes(listener))!(signal);
      expect(options.signal.aborted).toBe(true);
      return {...report, success: false};
    });
    expect(await runInit(workspace, {stdout, stderr})).toBe(code);
    expect(graph.close).toHaveBeenCalledOnce();
    expect(text(stderr)).toContain('cancelled');
    expect(text(stdout)).not.toContain('Graph ready');
    expect(process.listeners(signal)).toEqual(previous);
  });

  it('waits for graph close before reporting success', async () => {
    let finish!: () => void;
    graph.close.mockReturnValue(new Promise<void>(resolve => {finish = resolve;}));
    const running = runInit(workspace, {stdout, stderr});
    await vi.waitFor(() => expect(graph.close).toHaveBeenCalledOnce());
    expect(text(stdout)).not.toContain('Graph ready');
    finish();
    expect(await running).toBe(0);
    expect(text(stdout)).toContain('Graph ready');
  });
});
