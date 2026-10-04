import {EventEmitter} from 'node:events';
import {describe, expect, it, vi} from 'vitest';
import {createServer} from 'node:http';
import {startChatServer} from '../../src/chat/server.js';
import {createApp} from '@codeyantram/server';

vi.mock('node:http', () => ({createServer: vi.fn()}));
vi.mock('@codeyantram/server', async importOriginal => ({
	...await importOriginal<typeof import('@codeyantram/server')>(), createApp: vi.fn(),
}));

function fakeServer(address: unknown) {
	vi.mocked(createApp).mockReturnValue({close: vi.fn().mockResolvedValue(undefined), workspaceGraph: {}} as unknown as ReturnType<typeof createApp>);
	const server = Object.assign(new EventEmitter(), {
		listen: vi.fn(() => {queueMicrotask(() => server.emit('listening'));}),
		address: vi.fn(() => address),
		close: vi.fn((callback: (error?: Error) => void) => callback()),
		closeAllConnections: vi.fn(),
	});
	vi.mocked(createServer).mockReturnValue(server as unknown as ReturnType<typeof createServer>);
	return server;
}

describe('private server lifecycle failures', () => {
	it('forwards the selected workspace to its private server app', async () => {
		fakeServer({port: 1234});
		const running = await startChatServer({workspaceRoot: '/selected/project'});
		expect(createApp).toHaveBeenCalledExactlyOnceWith({workspaceRoot: '/selected/project'});
		await running.close();
		expect(vi.mocked(createApp).mock.results[0].value.close).toHaveBeenCalledOnce();
	});

	it.each([null, '/tmp/socket'])('rejects a non-TCP listening address: %j', async address => {
		const server = fakeServer(address);
		await expect(startChatServer()).rejects.toThrow('The chat server did not open a TCP port.');
		expect(server.close).toHaveBeenCalledOnce();
		expect(vi.mocked(createApp).mock.results[0].value.close).toHaveBeenCalledOnce();
	});

	it('reports close errors and still closes outstanding connections', async () => {
		const server = fakeServer({port: 1234});
		server.close.mockImplementationOnce(callback => callback(new Error('close failed')));
		const running = await startChatServer();
		expect(server.listen).toHaveBeenCalledWith(0, '127.0.0.1');
		await expect(running.close()).rejects.toThrow('close failed');
		expect(server.closeAllConnections).toHaveBeenCalledOnce();
		expect(vi.mocked(createApp).mock.results[0].value.close).toHaveBeenCalledOnce();
	});

	it('cleans up a listen failure before returning it to the CLI', async () => {
		const server = fakeServer({port: 1234});
		server.listen.mockImplementationOnce(() => {queueMicrotask(() => server.emit('error', new Error('listen failed')));});
		await expect(startChatServer()).rejects.toThrow('listen failed');
		expect(server.close).toHaveBeenCalledOnce();
		expect(server.closeAllConnections).toHaveBeenCalledOnce();
		expect(vi.mocked(createApp).mock.results[0].value.close).toHaveBeenCalledOnce();
	});
});
