import {once} from 'node:events';
import {createServer} from 'node:http';
import {createApp, createServerShutdown, type ServerAppOptions} from '@codeyantram/server';
import {initializeGraphForUI} from '../lib/init.js';

/** Each CLI owns a private localhost server, avoiding conflicts between sessions. */
export async function startChatServer(options: ServerAppOptions = {}) {
	const app = createApp(options);
	const server = createServer(app);
	const close = createServerShutdown(server, () => app.close());
	let address: ReturnType<typeof server.address>;
	try {
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		address = server.address();
		if (address === null || typeof address === 'string') throw new Error('The chat server did not open a TCP port.');
	} catch (error) {
		try {await close();} catch (cleanup) {
			throw new AggregateError([error, cleanup], 'Could not start or clean up the chat server.');
		}
		throw error;
	}

	const baseUrl = `http://127.0.0.1:${address.port}`;
	return {
		baseUrl,
		chatUrl: new URL('/chat', baseUrl).href,
		compactUrl: new URL('/compact', baseUrl).href,
		workspaceGraph: app.workspaceGraph,
		initializeGraph: (signal: AbortSignal, onProgress: (message: string) => void) =>
			initializeGraphForUI(graphOptions => app.workspaceGraph.initialize(graphOptions), signal, onProgress),
		close,
	};
}
