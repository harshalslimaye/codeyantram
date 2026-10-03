import React, {useEffect, useState} from 'react';
import {findSupportedChatModel, type EffortLevel, type SupportedChatModelDefinition} from '@codeyantram/shared';
import {ChatWorkspace} from './components/chat-workspace.js';
import {getGitBranch} from './lib/utils.js';
import {ThemeProvider} from './theme/provider.js';
import {KeyboardProvider} from './keyboard/provider.js';
import type {ThemeRegistry} from './theme/registry/registry.js';
import {saveModelPreference, type ModelPreferences} from './models/preferences.js';
import {ChatSession} from './chat/session.js';
import {requestChat, requestCompact} from './chat/client.js';

export function App({
	registry,
	initialThemeId,
	initialModelPreferences,
	serverBaseUrl,
}: {
	registry: ThemeRegistry;
	initialThemeId: string;
	initialModelPreferences: ModelPreferences;
	serverBaseUrl: string;
}) {
	const [modelPreferences, setModelPreferences] = useState(initialModelPreferences);
	const selectedModel: SupportedChatModelDefinition | undefined = findSupportedChatModel(modelPreferences.modelId);
	const effort = modelPreferences.effortByModel[modelPreferences.modelId] ?? selectedModel?.defaultEffortLevel;
	const [session] = useState(() => {
		const chatUrl = new URL('/chat', serverBaseUrl).href;
		const compactUrl = new URL('/compact', serverBaseUrl).href;
		return new ChatSession(
			(request, signal) => requestChat(chatUrl, request, signal),
			(request, signal) => requestCompact(compactUrl, request, signal),
		);
	});
	useEffect(() => () => session.cancel(), [session]);
	const branch = getGitBranch(process.cwd());
	async function selectModel(id: string, effort?: EffortLevel) {
		setModelPreferences(await saveModelPreference(id, effort));
	}

	return (
		<ThemeProvider registry={registry} initialThemeId={initialThemeId}>
			<KeyboardProvider>
				<ChatWorkspace session={session} modelPreferences={modelPreferences} effort={effort} branch={branch} onSelectModel={selectModel} />
			</KeyboardProvider>
		</ThemeProvider>
	);
}
