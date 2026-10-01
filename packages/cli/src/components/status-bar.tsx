import React from 'react';
import { Box, Text } from 'ink';
import {useTheme} from '../theme/provider.js';

export function StatusBar({ branch, model }: { branch: string; model: string }) {
	const {palette} = useTheme();
	const modelLabel = `model: ${model}`;

	return (
		<Box width="100%" paddingX={1}>
			<Text color={palette.status}>git:{branch}</Text>
			<Box flexGrow={1} justifyContent="flex-end">
				<Text color={palette.muted}>{modelLabel}</Text>
			</Box>
		</Box>
	);
}
