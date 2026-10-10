import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {createApp, createServerShutdown, type ServerAppOptions} from '@codeyantram/server';
import {initializeGraphForUI} from '../lib/init.js';
import {ApprovalController} from './approval.js';

const SESSION_TOKEN_BYTES = 32;

/** Each CLI owns a private localhost server, avoiding conflicts between sessions. */
export async function startChatServer(options: ServerAppOptions = {}) {
	const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString('hex');
	const approvals = new ApprovalController();
	const app = createApp({...options, privateSessionToken: sessionToken,
		approvePatch: approvals.approvePatch, approveCommand: approvals.approveCommand,
		authorizeAgent: request => ({patch: request.agentId === 'build', command: request.agentId === 'build'})});
	const server = createServer(app);
	const shutdown = createServerShutdown(server, () => app.close());
	const close = async () => {approvals.close(); await shutdown();};
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
	const fetchResponse: typeof fetch = (input, init) => fetch(input, {...init,
		headers: {...Object.fromEntries(new Headers(init?.headers)), 'x-codeyantram-session': sessionToken}});
	return {
		baseUrl,
		sessionToken,
		approvals,
		fetchResponse,
		chatUrl: new URL('/chat', baseUrl).href,
		compactUrl: new URL('/compact', baseUrl).href,
		workspaceGraph: app.workspaceGraph,
		initializeGraph: (signal: AbortSignal, onProgress: (message: string) => void) =>
			initializeGraphForUI(graphOptions => app.workspaceGraph.initialize(graphOptions), signal, onProgress),
		close,
	};
}
