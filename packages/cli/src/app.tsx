import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {findSupportedChatModel, saveModelPreference, type AgentMetadata, type EffortLevel, type ModelPreferences, type SupportedChatModelDefinition} from '@codeyantram/shared';
import {ChatWorkspace} from './components/chat-workspace.js';
import {getGitBranch} from './lib/utils.js';
import {ThemeProvider} from './theme/provider.js';
import {KeyboardProvider} from './keyboard/provider.js';
import type {ThemeRegistry} from './theme/registry/registry.js';
import {ChatSession, type InitTransport} from './chat/session.js';
import {requestChat, requestCompact} from './chat/client.js';
import type {ApprovalController} from './chat/approval.js';
import type {AgentSessionController} from './chat/agent-session.js';
import {FALLBACK_AGENT_METADATA, loadAgentMetadata} from './chat/agent-catalog.js';

// oxlint-disable-next-line eslint/max-lines-per-function -- This component wires the session and UI providers.
export function App({
	registry,
	initialThemeId,
	initialModelPreferences,
	serverBaseUrl,
	serverSessionToken,
	approvals,
	agentSession,
	workspaceRoot,
	initializeGraph,
}: {
	registry: ThemeRegistry;
	initialThemeId: string;
	initialModelPreferences: ModelPreferences;
	serverBaseUrl: string;
	serverSessionToken?: string;
	approvals?: ApprovalController;
	agentSession?: AgentSessionController;
	workspaceRoot: string;
	initializeGraph: InitTransport;
}) {
	const [modelPreferences, setModelPreferences] = useState(initialModelPreferences);
	const privateFetch = useMemo<typeof fetch>(() => (input, init) => fetch(input, {...init,
		headers: {...Object.fromEntries(new Headers(init?.headers)), ...(serverSessionToken !== undefined ? {'x-codeyantram-session': serverSessionToken} : {})}}), [serverSessionToken]);
	const {availableAgents, diagnostics, refreshAgents} = useAgentCatalog(serverBaseUrl, privateFetch);
	const reloadAgents = useCallback(() => reloadAgentCatalog(serverBaseUrl, privateFetch, refreshAgents), [serverBaseUrl, privateFetch, refreshAgents]);
	const selectedModel: SupportedChatModelDefinition | undefined = findSupportedChatModel(modelPreferences.modelId);
	const effort = modelPreferences.effortByModel[modelPreferences.modelId] ?? selectedModel?.defaultEffortLevel;
	const [session] = useState(() => {
		const chatUrl = new URL('/chat', serverBaseUrl).href;
		const compactUrl = new URL('/compact', serverBaseUrl).href;
		return new ChatSession(
			(request, signal) => requestChat(chatUrl, request, signal, privateFetch),
			(request, signal) => requestCompact(compactUrl, request, signal, privateFetch),
			initializeGraph,
		);
	});
	useEffect(() => () => session.cancel(), [session]);
	const branch = getGitBranch(workspaceRoot);
	async function selectModel(id: string, selectedEffort?: EffortLevel) {
		setModelPreferences(await saveModelPreference(id, selectedEffort));
	}

	return (
		<ThemeProvider registry={registry} initialThemeId={initialThemeId}>
			<KeyboardProvider>
				<ChatWorkspace session={session} approvals={approvals} agentSession={agentSession} availableAgents={availableAgents} agentDiagnostics={diagnostics} refreshAgents={refreshAgents} reloadAgents={reloadAgents} modelPreferences={modelPreferences} effort={effort} branch={branch} onSelectModel={selectModel} />
			</KeyboardProvider>
		</ThemeProvider>
	);
}

function useAgentCatalog(baseUrl: string, fetchResponse: typeof fetch) {
	const [availableAgents, setAvailableAgents] = useState<readonly AgentMetadata[]>(FALLBACK_AGENT_METADATA);
	const [diagnostics, setDiagnostics] = useState<readonly string[]>([]);
	const refreshAgents = useCallback(async () => {
		const agents = await loadAgentMetadata(baseUrl, fetchResponse);
		setAvailableAgents(agents);
		const response = await fetchResponse(new URL('/agents/diagnostics', baseUrl));
		if (response.ok) {
			const result: unknown = await response.json();
			if (Array.isArray(result)) setDiagnostics((result as unknown[]).filter((item): item is {filePath?: string; message: string} =>
				typeof item === 'object' && item !== null && 'message' in item && typeof item.message === 'string')
				.map(item => `${item.filePath ?? 'agent file'}: ${item.message}`));
		}
	}, [baseUrl, fetchResponse]);
	return {availableAgents, diagnostics, refreshAgents};
}

async function reloadAgentCatalog(baseUrl: string, fetchResponse: typeof fetch, refresh: () => Promise<void>) {
	const response = await fetchResponse(new URL('/agents/reload', baseUrl), {method: 'POST'});
	if (!response.ok) throw new Error(`Could not reload agents (HTTP ${response.status}).`);
	const result: unknown = await response.json();
	await refresh();
	if (typeof result !== 'object' || result === null || !('diagnostics' in result) || !Array.isArray(result.diagnostics)) return [];
	return (result.diagnostics as unknown[]).filter((item): item is {filePath?: string; message: string} =>
		typeof item === 'object' && item !== null && 'message' in item && typeof item.message === 'string');
}
