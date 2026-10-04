import React from 'react';
import { Box, Text } from 'ink';
import type {EffortLevel} from '@codeyantram/shared';
import {useTheme} from '../theme/provider.js';

export function StatusBar({ branch, model, effort, contextTurnCount }: { branch: string; model: string; effort?: EffortLevel; contextTurnCount?: number }) {
	const {palette} = useTheme();
	const modelLabel = `${model}${effort !== undefined ? ` » ${effort}` : ''}`;

	return (
		<Box width="100%" paddingX={1} flexDirection="column">
			<Box width="100%">
				<Text color={palette.status}>git:{branch}</Text>
				<Box flexGrow={1} justifyContent="flex-end">
					<Text color={palette.muted}>{modelLabel}</Text>
				</Box>
			</Box>
			{contextTurnCount !== undefined && <Text color={palette.muted}>Context: compacted · {contextTurnCount} recent {contextTurnCount === 1 ? 'turn' : 'turns'}</Text>}
		</Box>
	);
}
