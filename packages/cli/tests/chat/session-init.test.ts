import {describe, expect, it, vi} from 'vitest';
import {ChatSession, type ChatTransport, type InitTransport} from '../../src/chat/session.js';

const chat = () => vi.fn<ChatTransport>().mockImplementation(async function* () {
  yield {type: 'text-delta', text: 'Existing conversation'};
  yield {type: 'done', durationMs: 1};
});

describe('session graph initialization', () => {
  it('reports progress and completion while preserving the conversation and avoiding model calls', async () => {
    const transport = chat();
    const init = vi.fn<InitTransport>().mockImplementation(async (_signal, progress) => {
      progress('Indexing graph · parsing: 1/2');
      return 'Graph ready: 2 files, 4 symbols, 3 relationships.';
    });
    const session = new ChatSession(transport, undefined, init);
    await session.send('Previous question', 'gemma-4-31b-it');
    const messages = structuredClone(session.getSnapshot().messages);
    const notices: (string | undefined)[] = [];
    session.subscribe(() => notices.push(session.getSnapshot().notice));
    await session.initialize();
    expect(transport).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toMatchObject({operation: 'idle', isStreaming: false, messages, notice: 'Graph ready: 2 files, 4 symbols, 3 relationships.'});
    expect(notices).toContain('Indexing graph · parsing: 1/2');
  });

  it('blocks overlapping work and keeps cancellation busy until graph cleanup drains', async () => {
    let signal!: AbortSignal;
    let progress!: (message: string) => void;
    let finish!: (message: string) => void;
    const transport = chat();
    const init = vi.fn<InitTransport>().mockImplementationOnce(async (activeSignal, update) => {
      signal = activeSignal;
      progress = update;
      return new Promise<string>(resolve => {finish = resolve;});
    }).mockResolvedValue('Graph ready after retry.');
    const session = new ChatSession(transport, undefined, init);
    const running = session.initialize();
    await session.initialize();
    await session.send('Blocked', 'gemma-4-31b-it');
    expect(await session.compact('gemma-4-31b-it')).toEqual({type: 'busy'});
    expect(init).toHaveBeenCalledOnce();
    expect(transport).not.toHaveBeenCalled();
    session.cancel();
    expect(signal.aborted).toBe(true);
    expect(session.getSnapshot().operation).toBe('init');
    progress('Stale progress');
    expect(session.getSnapshot().notice).toContain('Cancelling');
    await session.initialize();
    expect(init).toHaveBeenCalledOnce();
    finish('Ignored completion');
    await running;
    expect(session.getSnapshot()).toMatchObject({operation: 'idle', notice: 'Graph initialization cancelled. Use /init to retry.'});
    await session.initialize();
    expect(session.getSnapshot().notice).toBe('Graph ready after retry.');
  });

  it('clear cancels initialization without releasing its operation until cleanup', async () => {
    let finish!: (message: string) => void;
    const session = new ChatSession(chat(), undefined, async () => new Promise<string>(resolve => {finish = resolve;}));
    await session.send('Previous question', 'gemma-4-31b-it');
    const running = session.initialize();
    session.clear();
    expect(session.getSnapshot()).toMatchObject({operation: 'init', messages: []});
    finish('Ignored');
    await running;
    expect(session.getSnapshot()).toMatchObject({operation: 'idle', messages: []});
  });

  it('does not start indexing when initialization is cancelled synchronously by a subscriber', async () => {
    const init = vi.fn<InitTransport>();
    const session = new ChatSession(chat(), undefined, init);
    session.subscribe(() => {
      if (session.getSnapshot().operation === 'init' && session.getSnapshot().notice?.startsWith('Cancelling') !== true) session.cancel();
    });
    await session.initialize();
    expect(init).not.toHaveBeenCalled();
    expect(session.getSnapshot().operation).toBe('idle');
  });

  it('surfaces initialization errors without changing chat history', async () => {
    const session = new ChatSession(chat(), undefined, async () => {throw new Error('Graph lock unavailable.');});
    await session.send('Previous question', 'gemma-4-31b-it');
    const messages = structuredClone(session.getSnapshot().messages);
    await session.initialize();
    expect(session.getSnapshot()).toMatchObject({operation: 'idle', messages, error: 'Graph lock unavailable.'});
  });
});
