import {requireValue, asymmetric} from '../../shared/tests/helpers.js';
import {EventEmitter} from 'node:events';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({createApp: vi.fn<() => {listen: (port: number, host: string, callback: () => void) => typeof server; close: () => Promise<void>}>(), listen: vi.fn<(port: number, host: string, callback: () => void) => typeof server>(), closeApp: vi.fn<() => Promise<void>>()}));
vi.mock('../src/app.js', () => ({createApp: mocks.createApp}));

let server: EventEmitter & {close: ReturnType<typeof vi.fn>; closeAllConnections: ReturnType<typeof vi.fn>};
let previousExitCode: typeof process.exitCode;
let signalHandlers: {signal: NodeJS.Signals; handler: () => void}[];

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  previousExitCode = process.exitCode;
  signalHandlers = [];
  server = Object.assign(new EventEmitter(), {close: vi.fn<(callback: (error?: Error) => void) => void>((callback: (error?: Error) => void) => callback()), closeAllConnections: vi.fn<() => void>()});
  mocks.closeApp.mockResolvedValue(undefined);
  mocks.createApp.mockReturnValue({listen: mocks.listen, close: mocks.closeApp});
  mocks.listen.mockImplementation((_port: number, _host: string, onListening: () => void) => {
    queueMicrotask(onListening);
    return server;
  });
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const once = process.once.bind(process);
  vi.spyOn(process, 'once').mockImplementation((event, listener) => {
    if (event === 'SIGINT' || event === 'SIGTERM') {
      signalHandlers.push({signal: event, handler: listener as () => void});
    }
    return once(event, listener);
  });
});

afterEach(() => {
  for (const {signal, handler} of signalHandlers) process.off(signal, handler);
  server.removeAllListeners();
  process.exitCode = previousExitCode;
});

describe('standalone server entry point', () => {
  it('uses the default port and binds only to localhost', async () => {
    vi.stubEnv('CODEYANTRAM_PORT', undefined);
    await import('../src/main.js');
    expect(mocks.createApp).toHaveBeenCalledOnce();
    expect(mocks.createApp).toHaveBeenCalledWith({workspaceRoot: process.env.INIT_CWD ?? process.cwd()});
    expect(mocks.listen).toHaveBeenCalledExactlyOnceWith(43187, '127.0.0.1', asymmetric.any(Function));
    expect(process.stdout.write).toHaveBeenCalledExactlyOnceWith('Codeyantram server listening at http://127.0.0.1:43187\n');
    expect(process.stderr.write).not.toHaveBeenCalled();
  });

  it.each([1, 31337, 65535])('accepts a configured TCP port: %i', async port => {
    vi.stubEnv('CODEYANTRAM_PORT', String(port));
    await import('../src/main.js');
    expect(mocks.listen).toHaveBeenCalledExactlyOnceWith(port, '127.0.0.1', asymmetric.any(Function));
    expect(process.stdout.write).toHaveBeenCalledWith(`Codeyantram server listening at http://127.0.0.1:${port}\n`);
  });

  it.each(['', 'not-a-number', '1.5', '0', '-1', '65536', 'Infinity'])('rejects an invalid port before creating the app: %j', async port => {
    vi.stubEnv('CODEYANTRAM_PORT', port);
    await expect(import('../src/main.js')).rejects.toThrow('CODEYANTRAM_PORT must be an integer between 1 and 65535.');
    expect(mocks.createApp).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(signalHandlers).toEqual([]);
  });

  it('reports a startup error and marks the process as failed', async () => {
    vi.stubEnv('CODEYANTRAM_PORT', '43187');
    mocks.listen.mockReturnValueOnce(server);
    await import('../src/main.js');
    server.emit('error', new Error('address already in use'));
    expect(process.stderr.write).toHaveBeenCalledExactlyOnceWith('Could not start the server: address already in use\n');
    expect(process.exitCode).toBe(1);
    expect(process.stdout.write).not.toHaveBeenCalled();
  });

  it.each(['SIGINT', 'SIGTERM'] as const)('closes the server and active connections on %s', async signal => {
    vi.stubEnv('CODEYANTRAM_PORT', undefined);
    await import('../src/main.js');
    expect(process.once).toHaveBeenCalledWith('SIGINT', asymmetric.any(Function));
    expect(process.once).toHaveBeenCalledWith('SIGTERM', asymmetric.any(Function));
    requireValue(signalHandlers.find(entry => entry.signal === signal)).handler();
    expect(server.close).toHaveBeenCalledOnce();
    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    expect(server.close.mock.invocationCallOrder[0]).toBeLessThan(requireValue(server.closeAllConnections.mock.invocationCallOrder[0]));
    await vi.waitFor(() => expect(mocks.closeApp).toHaveBeenCalledOnce());
  });
});
