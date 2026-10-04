import {EventEmitter} from 'node:events';
import {describe, expect, it, vi} from 'vitest';
import {createServer} from 'node:http';
import {startChatServer} from '../../src/chat/server.js';

vi.mock('node:http', () => ({createServer: vi.fn()}));
vi.mock('@codeyantram/server', () => ({createApp: vi.fn(() => 'app')}));

function fakeServer(address: unknown) {
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
	it.each([null, '/tmp/socket'])('rejects a non-TCP listening address: %j', async address => {
		fakeServer(address);
		await expect(startChatServer()).rejects.toThrow('The chat server did not open a TCP port.');
	});

	it('reports close errors and still closes outstanding connections', async () => {
		const server = fakeServer({port: 1234});
		server.close.mockImplementationOnce(callback => callback(new Error('close failed')));
		const running = await startChatServer();
		expect(server.listen).toHaveBeenCalledWith(0, '127.0.0.1');
		await expect(running.close()).rejects.toThrow('close failed');
		expect(server.closeAllConnections).toHaveBeenCalledOnce();
	});
});
