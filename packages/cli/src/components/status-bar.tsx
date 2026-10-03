import React from 'react';
import { Box, Text } from 'ink';
import type {EffortLevel} from '@codeyantram/shared';
import {useTheme} from '../theme/provider.js';

export function StatusBar({ branch, model, effort }: { branch: string; model: string; effort?: EffortLevel }) {
	const {palette} = useTheme();
	const modelLabel = `${model}${effort !== undefined ? ` » ${effort}` : ''}`;

	return (
		<Box width="100%" paddingX={1}>
			<Text color={palette.status}>git:{branch}</Text>
			<Box flexGrow={1} justifyContent="flex-end">
				<Text color={palette.muted}>{modelLabel}</Text>
			</Box>
		</Box>
	);
}
