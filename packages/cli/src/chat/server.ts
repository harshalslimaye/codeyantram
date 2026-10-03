import {once} from 'node:events';
import {createServer} from 'node:http';
import {createApp, type ServerAppOptions} from '@codeyantram/server';

/** Each CLI owns a private localhost server, avoiding conflicts between sessions. */
export async function startChatServer(options: ServerAppOptions = {}) {
	const server = createServer(createApp(options));
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('The chat server did not open a TCP port.');

	return {
		url: `http://127.0.0.1:${address.port}/chat`,
		close: () => new Promise<void>((resolve, reject) => {
			server.close(error => {if (error) reject(error); else resolve();});
			server.closeAllConnections();
		}),
	};
}
