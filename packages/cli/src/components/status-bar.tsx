import React from 'react';
import { Box, Text, useWindowSize } from 'ink';
import type {EffortLevel} from '@codeyantram/shared';
import {useTheme} from '../theme/provider.js';
import { Badge } from '@inkjs/ui';
import type {ContextStatus} from '../chat/context.js';
import {formatContextPercent} from './session-status.js';

export function StatusBar({ branch, model, effort, contextTurnCount, contextStatus }: { branch: string; model: string; effort?: EffortLevel; contextTurnCount?: number; contextStatus: ContextStatus }) {
	const {palette} = useTheme();
	const {columns} = useWindowSize();
	const modelLabel = `${model}${effort !== undefined ? ` » ${effort}` : ''}`;

	return (
		<Box width="100%" paddingX={1} flexDirection="column">
			<Box width="100%">
				<Badge color={palette.primary}><Text color={palette.text}>git:{branch}</Text></Badge>
				<Box marginX={1} flexShrink={0}>
					<Text color={palette.muted}>{columns >= 60 ? 'Context' : 'Ctx'} ~{formatContextPercent(contextStatus.usedPercent)}%{columns >= 60 ? ' used' : ''}</Text>
				</Box>
				<Box flexGrow={1} flexBasis={0} minWidth={0} justifyContent="flex-end">
					<Text color={palette.muted} wrap="truncate-end">{modelLabel}</Text>
				</Box>
			</Box>
			{contextTurnCount !== undefined && <Text color={palette.muted}>Context: compacted · {contextTurnCount} recent {contextTurnCount === 1 ? 'turn' : 'turns'}</Text>}
		</Box>
	);
}
