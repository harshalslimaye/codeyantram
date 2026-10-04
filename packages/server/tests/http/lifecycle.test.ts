import {describe, expect, it, vi} from 'vitest';
import {createServerShutdown} from '../../src/index.js';

describe('combined HTTP/application shutdown', () => {
  it('waits for application resources, closes connections, and reuses one shutdown promise', async () => {
    let finish!: () => void;
    const release = vi.fn(() => new Promise<void>(resolve => {finish = resolve;}));
    const server = {close: vi.fn((callback: (error?: Error) => void) => callback()), closeAllConnections: vi.fn()};
    const close = createServerShutdown(server as never, release);
    const running = close();
    expect(close()).toBe(running);
    await Promise.resolve();
    expect(release).toHaveBeenCalledOnce();
    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    finish(); await running;
    expect(server.close).toHaveBeenCalledOnce();
  });

  it('still releases resources if the HTTP server reports an error', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const server = {close: vi.fn((callback: (error?: Error) => void) => callback(new Error('HTTP close failed'))), closeAllConnections: vi.fn()};
    await expect(createServerShutdown(server as never, release)()).rejects.toThrow('HTTP close failed');
    expect(release).toHaveBeenCalledOnce();
    expect(server.closeAllConnections).toHaveBeenCalledOnce();
  });

  it('allows cleanup after a listen failure left the server unopened', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const error = Object.assign(new Error('not listening'), {code: 'ERR_SERVER_NOT_RUNNING'});
    const server = {close: vi.fn((callback: (error?: Error) => void) => callback(error)), closeAllConnections: vi.fn()};
    await createServerShutdown(server as never, release)();
    expect(release).toHaveBeenCalledOnce();
  });

  it('preserves both HTTP and application cleanup failures', async () => {
    const first = new Error('database close failed');
    const second = new Error('HTTP close failed');
    const server = {close: vi.fn((callback: (error?: Error) => void) => callback(second)), closeAllConnections: vi.fn()};
    await expect(createServerShutdown(server as never, async () => {throw first;})()).rejects.toMatchObject({errors: [first, second]});
    expect(server.closeAllConnections).toHaveBeenCalledOnce();
  });
});
