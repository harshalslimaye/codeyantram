import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {createApp, createServerShutdown, loadAgentFiles, type ServerAppOptions} from '@codeyantram/server';
import {initializeGraphForUI} from '../lib/init.js';
import {ApprovalController} from './approval.js';
import {AgentSessionController, type AgentSelection} from './agent-session.js';
import type {ChatRequest} from '@codeyantram/shared';

const SESSION_TOKEN_BYTES = 32;

/** Each CLI owns a private localhost server, avoiding conflicts between sessions. */
export async function startChatServer(options: ServerAppOptions & {
	automaticCapabilities?: {patch: boolean; command: boolean};
} = {}) {
	const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString('hex');
	const approvals = new ApprovalController();
	const initialAgents = await loadAgentFiles(options.workspaceRoot);
	const agentSession = new AgentSessionController(options.automaticCapabilities ?? {patch: true, command: true},
		options.workspaceRoot !== undefined && options.workspaceRoot !== '');
	const app = createPrivateApp({...options, initialAgents,
		reloadAgents: async () => {
			const next = await loadAgentFiles(options.workspaceRoot);
			agentSession.reconcile(next.registry.get(agentSession.getSnapshot().id)?.approval);
			return next;
		}}, sessionToken, approvals, agentSession);
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
		agentSession,
		fetchResponse,
		chatUrl: new URL('/chat', baseUrl).href,
		compactUrl: new URL('/compact', baseUrl).href,
		workspaceGraph: app.workspaceGraph,
		initializeGraph: (signal: AbortSignal, onProgress: (message: string) => void) =>
			initializeGraphForUI(graphOptions => app.workspaceGraph.initialize(graphOptions), signal, onProgress),
		close,
	};
}

function createPrivateApp(options: ServerAppOptions, sessionToken: string, approvals: ApprovalController,
	agentSession: AgentSessionController) {
	const turnSelections = new WeakMap<ChatRequest, AgentSelection>();
	const selectedTurn = (request: ChatRequest) => turnSelections.get(request);
	const automaticPatch = async () => true;
	const automaticCommand = async () => true;
	return createApp({...options, privateSessionToken: sessionToken,
		approvePatch: approvals.approvePatch, approveCommand: approvals.approveCommand,
		validateAgent: request => {
			const snapshot = agentSession.getSnapshot();
			if (!agentSession.isValid() || !agentSession.matches(request, snapshot)) return false;
			turnSelections.set(request, snapshot);
			return true;
		},
		authorizeAgent: request => agentSession.authorize(request, selectedTurn(request)),
		approvePatchForTurn: request => selectedTurn(request)?.yoloActive === true ? automaticPatch : approvals.approvePatch,
		approveCommandForTurn: request => selectedTurn(request)?.yoloActive === true ? automaticCommand : approvals.approveCommand,
		agentStatus: (id, approval) => agentSession.status(id, approval),
	});
}
