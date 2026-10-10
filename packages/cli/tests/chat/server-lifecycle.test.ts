import {requireValue} from '../../../shared/tests/helpers.js';
import type * as ServerModule from '@codeyantram/server';
import {EventEmitter} from 'node:events';
import {describe, expect, it, vi} from 'vitest';
import {createServer} from 'node:http';
import {startChatServer} from '../../src/chat/server.js';
import {createApp} from '@codeyantram/server';

vi.mock('node:http', () => ({createServer: vi.fn<typeof createServer>()}));
vi.mock('@codeyantram/server', async importOriginal => ({
	...await importOriginal<typeof ServerModule>(), createApp: vi.fn<typeof createApp>(),
}));

function fakeServer(address: unknown) {
	vi.mocked(createApp).mockReturnValue({close: vi.fn<(callback: (error?: Error) => void) => void>().mockResolvedValue(undefined), workspaceGraph: {}} as unknown as ReturnType<typeof createApp>);
	const server = Object.assign(new EventEmitter(), {
		listen: vi.fn<(port: number, host: string) => void>(() => {queueMicrotask(() => server.emit('listening'));}),
		address: vi.fn<() => unknown>(() => address),
		close: vi.fn<(callback: (error?: Error) => void) => void>((callback: (error?: Error) => void) => callback()),
		closeAllConnections: vi.fn<() => void>(),
	});
	vi.mocked(createServer).mockReturnValue(server as unknown as ReturnType<typeof createServer>);
	return server;
}

function appMock() {
  const result = requireValue(vi.mocked(createApp).mock.results[0]);
  if (result.type !== 'return') throw new Error('Expected createApp to return.');
  return result.value;
}

describe('private server lifecycle failures', () => {
	it('forwards the selected workspace to its private server app', async () => {
		fakeServer({port: 1234});
		const running = await startChatServer({workspaceRoot: '/selected/project'});
		expect(createApp).toHaveBeenCalledExactlyOnceWith({workspaceRoot: '/selected/project'});
		await running.close();
		expect(appMock().close).toHaveBeenCalledOnce();
	});

	it.each([null, '/tmp/socket'])('rejects a non-TCP listening address: %j', async address => {
		const server = fakeServer(address);
		await expect(startChatServer()).rejects.toThrow('The chat server did not open a TCP port.');
		expect(server.close).toHaveBeenCalledOnce();
		expect(appMock().close).toHaveBeenCalledOnce();
	});

	it('reports close errors and still closes outstanding connections', async () => {
		const server = fakeServer({port: 1234});
		server.close.mockImplementationOnce(callback => callback(new Error('close failed')));
		const running = await startChatServer();
		expect(server.listen).toHaveBeenCalledWith(0, '127.0.0.1');
		await expect(running.close()).rejects.toThrow('close failed');
		expect(server.closeAllConnections).toHaveBeenCalledOnce();
		expect(appMock().close).toHaveBeenCalledOnce();
	});

	it('cleans up a listen failure before returning it to the CLI', async () => {
		const server = fakeServer({port: 1234});
		server.listen.mockImplementationOnce(() => {queueMicrotask(() => server.emit('error', new Error('listen failed')));});
		await expect(startChatServer()).rejects.toThrow('listen failed');
		expect(server.close).toHaveBeenCalledOnce();
		expect(server.closeAllConnections).toHaveBeenCalledOnce();
		expect(appMock().close).toHaveBeenCalledOnce();
	});
});
