import React from 'react';
import { Box, Text } from 'ink';
import type {EffortLevel} from '@codeyantram/shared';
import {useTheme} from '../theme/provider.js';
import { Badge } from '@inkjs/ui';

export function StatusBar({ branch, model, effort, contextTurnCount }: { branch: string; model: string; effort?: EffortLevel; contextTurnCount?: number }) {
	const {palette} = useTheme();
	const modelLabel = `${model}${effort !== undefined ? ` » ${effort}` : ''}`;

	return (
		<Box width="100%" paddingX={1} flexDirection="column">
			<Box width="100%">
				<Badge color={palette.primary}><Text color={palette.text}>git:{branch}</Text></Badge>
				<Box flexGrow={1} justifyContent="flex-end">
					<Text color={palette.muted}>{modelLabel}</Text>
				</Box>
			</Box>
			{contextTurnCount !== undefined && <Text color={palette.muted}>Context: compacted · {contextTurnCount} recent {contextTurnCount === 1 ? 'turn' : 'turns'}</Text>}
		</Box>
	);
}
