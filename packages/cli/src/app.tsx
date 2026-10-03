import React, {useState} from 'react';
import {Box, useWindowSize} from 'ink';
import {findSupportedChatModel, type EffortLevel, type SupportedChatModelDefinition} from '@codeyantram/shared';
import {InputBar} from './components/input-bar.js';
import {StatusBar} from './components/status-bar.js';
import {getGitBranch} from './lib/utils.js';
import {ThemeProvider} from './theme/provider.js';
import {KeyboardProvider} from './keyboard/provider.js';
import type {ThemeRegistry} from './theme/registry/registry.js';
import {saveModelPreference, type ModelPreferences} from './models/preferences.js';

export function App({
	registry,
	initialThemeId,
	initialModelPreferences,
}: {
	registry: ThemeRegistry;
	initialThemeId: string;
	initialModelPreferences: ModelPreferences;
}) {
	const [modelPreferences, setModelPreferences] = useState(initialModelPreferences);
	const selectedModel: SupportedChatModelDefinition | undefined = findSupportedChatModel(modelPreferences.modelId);
	const effort = modelPreferences.effortByModel[modelPreferences.modelId] ?? selectedModel?.defaultEffortLevel;
	const {rows} = useWindowSize();
	const branch = getGitBranch(process.cwd());
	async function selectModel(id: string, effort?: EffortLevel) {
		setModelPreferences(await saveModelPreference(id, effort));
	}

	return (
		<ThemeProvider registry={registry} initialThemeId={initialThemeId}>
			<KeyboardProvider>
				<Box flexDirection="column" height={rows}>
					<Box flexGrow={1} />
					<InputBar modelPreferences={modelPreferences} onSelectModel={selectModel} />
					<StatusBar branch={branch} model={modelPreferences.modelId} effort={effort} />
				</Box>
			</KeyboardProvider>
		</ThemeProvider>
	);
}
