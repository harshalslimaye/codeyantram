import React, {useEffect, useState} from 'react';
import {findSupportedChatModel, saveModelPreference, type EffortLevel, type ModelPreferences, type SupportedChatModelDefinition} from '@codeyantram/shared';
import {ChatWorkspace} from './components/chat-workspace.js';
import {getGitBranch} from './lib/utils.js';
import {ThemeProvider} from './theme/provider.js';
import {KeyboardProvider} from './keyboard/provider.js';
import type {ThemeRegistry} from './theme/registry/registry.js';
import {ChatSession, type InitTransport} from './chat/session.js';
import {requestChat, requestCompact} from './chat/client.js';
import type {ApprovalController} from './chat/approval.js';

export function App({
	registry,
	initialThemeId,
	initialModelPreferences,
	serverBaseUrl,
	serverSessionToken,
	approvals,
	workspaceRoot,
	initializeGraph,
}: {
	registry: ThemeRegistry;
	initialThemeId: string;
	initialModelPreferences: ModelPreferences;
	serverBaseUrl: string;
	serverSessionToken?: string;
	approvals?: ApprovalController;
	workspaceRoot: string;
	initializeGraph: InitTransport;
}) {
	const [modelPreferences, setModelPreferences] = useState(initialModelPreferences);
	const selectedModel: SupportedChatModelDefinition | undefined = findSupportedChatModel(modelPreferences.modelId);
	const effort = modelPreferences.effortByModel[modelPreferences.modelId] ?? selectedModel?.defaultEffortLevel;
	const [session] = useState(() => {
		const privateFetch: typeof fetch = (input, init) => fetch(input, {...init,
			headers: {...Object.fromEntries(new Headers(init?.headers)), ...(serverSessionToken !== undefined ? {'x-codeyantram-session': serverSessionToken} : {})}});
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
				<ChatWorkspace session={session} approvals={approvals} modelPreferences={modelPreferences} effort={effort} branch={branch} onSelectModel={selectModel} />
			</KeyboardProvider>
		</ThemeProvider>
	);
}
