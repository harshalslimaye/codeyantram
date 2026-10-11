import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {chatGPTSupportedEfforts, findSupportedChatModel, readModelPreferences, saveModelPreference, saveProviderApiKey, SUPPORTED_CHAT_MODELS,
	type AgentMetadata, type ConnectableProvider, type EffortLevel, type ModelPreferences, type SupportedChatModelDefinition} from '@codeyantram/shared';
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
import {chatgptCommand, loadChatGPTAccounts, loadChatGPTModels, saveOpenAIApiKey, type ChatGPTAccountModel} from './chat/chatgpt.js';

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
	const [chatgptModels, setChatGPTModels] = useState<ChatGPTAccountModel[]>([]);
	const privateFetch = useMemo<typeof fetch>(() => (input, init) => fetch(input, {...init,
		headers: {...Object.fromEntries(new Headers(init?.headers)), ...(serverSessionToken !== undefined ? {'x-codeyantram-session': serverSessionToken} : {})}}), [serverSessionToken]);
	const {availableAgents, diagnostics, refreshAgents} = useAgentCatalog(serverBaseUrl, privateFetch);
	const reloadAgents = useCallback(() => reloadAgentCatalog(serverBaseUrl, privateFetch, refreshAgents), [serverBaseUrl, privateFetch, refreshAgents]);
	const refreshChatGPTModels = useCallback(async () => {
		if (serverSessionToken === undefined) return [];
		const models = await loadChatGPTModels(serverBaseUrl, privateFetch);
		setChatGPTModels(models);
		return models;
	}, [serverBaseUrl, privateFetch, serverSessionToken]);
	useEffect(() => {
		if (serverSessionToken === undefined) return;
		let active = true;
		void loadChatGPTModels(serverBaseUrl, privateFetch).then(models => {if (active) setChatGPTModels(models); return models;}).catch(() => {});
		return () => {active = false;};
	}, [serverBaseUrl, privateFetch, serverSessionToken]);
	const selectedModel: SupportedChatModelDefinition | undefined = findSupportedChatModel(modelPreferences.modelId);
	const selectedChatGPTModel = modelPreferences.openaiConnection === 'chatgpt'
		? chatgptModels.find(model => model.id === modelPreferences.modelId) : undefined;
	const savedEffort = modelPreferences.effortByModel[modelPreferences.modelId];
	let effort: EffortLevel | undefined = savedEffort ?? selectedModel?.defaultEffortLevel;
	if (selectedChatGPTModel !== undefined) effort = chatGPTSupportedEfforts(selectedChatGPTModel.id, selectedChatGPTModel.supportedEffortLevels).find(level => level === savedEffort);
	else if (modelPreferences.openaiConnection === 'chatgpt' && (selectedModel?.provider === 'openai' || selectedModel === undefined)) effort = undefined;
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
		if (modelPreferences.openaiConnection === 'chatgpt' && (findSupportedChatModel(id)?.provider === 'openai' || !findSupportedChatModel(id))) {
			const model = chatgptModels.find(item => item.id === id);
			if (!model) throw new Error('ChatGPT model is not available to the selected account.');
			if (selectedEffort !== undefined && !chatGPTSupportedEfforts(id, model.supportedEffortLevels).includes(selectedEffort)) throw new Error('This ChatGPT model does not support that effort.');
		}
		setModelPreferences(await saveModelPreference(id, selectedEffort));
	}
	async function saveConnectionKey(provider: ConnectableProvider, apiKey: string) {
		if (provider !== 'openai') {await saveProviderApiKey(provider, apiKey); return;}
		await saveOpenAIApiKey(serverBaseUrl, privateFetch, apiKey);
		setChatGPTModels([]);
		const current = findSupportedChatModel(modelPreferences.modelId);
		const fallback = SUPPORTED_CHAT_MODELS.find(model => model.provider === 'openai');
		const id = current?.provider === 'openai' ? current.id : fallback?.id;
		if (id !== undefined) setModelPreferences(await saveModelPreference(id));
		else setModelPreferences(await readModelPreferences());
	}
	async function runChatGPTCommand(command: string, profileId?: string, signal?: AbortSignal) {
		const result = await chatgptCommand({baseUrl: serverBaseUrl, fetcher: privateFetch}, command, profileId, signal);
		const models = await refreshChatGPTModels().catch(() => {setChatGPTModels([]); return [];});
		if (command === 'login' || command === 'use') {
			if (models.length === 0) {setModelPreferences(await readModelPreferences()); return `${result} No ChatGPT plan models are available for this account. Check /chatgpt status.`;}
			const selected = models.find(model => model.id === modelPreferences.modelId) ?? models[0];
			if (selected === undefined) return result;
			try {
				setModelPreferences(await saveModelPreference(selected.id));
				return `${result} Using ${selected.id}.`;
			} catch {
				return `${result} Could not save the model choice. Choose a ChatGPT model with /model.`;
			}
		}
		return result;
	}
	const loadAccounts = () => loadChatGPTAccounts(serverBaseUrl, privateFetch);

	return (
		<ThemeProvider registry={registry} initialThemeId={initialThemeId}>
			<KeyboardProvider>
				<ChatWorkspace session={session} approvals={approvals} agentSession={agentSession} availableAgents={availableAgents} agentDiagnostics={diagnostics} refreshAgents={refreshAgents} reloadAgents={reloadAgents} modelPreferences={modelPreferences} effort={effort} branch={branch} onSelectModel={selectModel} chatgptModels={chatgptModels} onChatGPTCommand={runChatGPTCommand} onLoadChatGPTAccounts={loadAccounts} onSaveProviderKey={saveConnectionKey} />
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
