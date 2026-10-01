import React from 'react';
import { Box, Text } from 'ink';

export function StatusBar({ branch, model }: { branch: string; model: string }) {
	const modelLabel = `model: ${model}`;

	return (
		<Box width="100%" paddingX={1}>
			<Text color="yellow">git:{branch}</Text>
			<Box flexGrow={1} justifyContent="flex-end">
				<Text color="gray">{modelLabel}</Text>
			</Box>
		</Box>
	);
}
