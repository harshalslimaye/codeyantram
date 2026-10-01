import React from 'react';
import {Box, useWindowSize} from 'ink';
import {MODEL_NAME} from './config.js';
import {InputBar} from './components/input-bar.js';
import {StatusBar} from './components/status-bar.js';
import { getGitBranch } from './lib/utils.js';

export function App() {
	const {rows} = useWindowSize();
	const branch = getGitBranch(process.cwd()); 

	return (
		<Box flexDirection="column" height={rows}>
			<Box flexGrow={1} />
			<InputBar />
			<StatusBar branch={branch} model={MODEL_NAME} />
		</Box>
	);
}
