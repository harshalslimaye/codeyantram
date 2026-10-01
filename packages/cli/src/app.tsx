import React from 'react';
import {Box, useWindowSize} from 'ink';
import {MODEL_NAME} from './config.js';
import {InputBar} from './components/input-bar.js';
import {StatusBar} from './components/status-bar.js';
import {getGitBranch} from './lib/utils.js';
import {ThemeProvider} from './theme/provider.js';
import {KeyboardProvider} from './keyboard/provider.js';
import type {ThemeRegistry} from './theme/registry/registry.js';

export function App({
	registry,
	initialThemeId,
}: {
	registry: ThemeRegistry;
	initialThemeId: string;
}) {
	const {rows} = useWindowSize();
	const branch = getGitBranch(process.cwd());

	return (
		<ThemeProvider registry={registry} initialThemeId={initialThemeId}>
			<KeyboardProvider>
				<Box flexDirection="column" height={rows}>
					<Box flexGrow={1} />
					<InputBar />
					<StatusBar branch={branch} model={MODEL_NAME} />
				</Box>
			</KeyboardProvider>
		</ThemeProvider>
	);
}
