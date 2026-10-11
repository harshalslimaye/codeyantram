import React from 'react';
import { Box, Text, useWindowSize } from 'ink';
import type {EffortLevel} from '@codeyantram/shared';
import {useTheme} from '../theme/provider.js';
import { Badge } from '@inkjs/ui';
import type {ContextStatus} from '../chat/context.js';
import {formatContextPercent} from './session-status.js';
import type {CliAgentId} from '../chat/agent-session.js';

const SECONDS_PER_MINUTE = 60;

export function StatusBar({ branch, agent = 'ask', automaticActive = false, model, effort, contextTurnCount, contextStatus }: { branch: string; agent?: CliAgentId; automaticActive?: boolean; model: string; effort?: EffortLevel; contextTurnCount?: number; contextStatus: ContextStatus }) {
	const {palette} = useTheme();
	const {columns} = useWindowSize();
	const modelLabel = `${model}${effort !== undefined ? ` » ${effort}` : ''}`;
	const agentLabel = displayAgent(agent, automaticActive);

	return (
		<Box width="100%" paddingX={1} flexDirection="column">
			<Box width="100%">
				<Badge color={palette.primary}><Text color={palette.text}>git:{branch}</Text></Badge>
				<Box marginX={1} flexShrink={0}><Text color={automaticActive || agent === 'yolo' ? palette.prompt : palette.muted}>{agentLabel}</Text></Box>
				<Box marginX={1} flexShrink={0}>
					<Text color={palette.muted}>{columns >= SECONDS_PER_MINUTE ? 'Context' : 'Ctx'} ~{formatContextPercent(contextStatus.usedPercent)}%{columns >= SECONDS_PER_MINUTE ? ' used' : ''}</Text>
				</Box>
				<Box flexGrow={1} flexBasis={0} minWidth={0} justifyContent="flex-end">
					<Text color={palette.muted} wrap="truncate-end">{modelLabel}</Text>
				</Box>
			</Box>
			{contextTurnCount !== undefined && <Text color={palette.muted}>Context: compacted · {contextTurnCount} recent {contextTurnCount === 1 ? 'turn' : 'turns'}</Text>}
		</Box>
	);
}

function displayAgent(agent: CliAgentId, automaticActive: boolean): string {
	if (agent === 'ask') return 'Ask';
	if (agent === 'build') return 'Build';
	if (agent === 'yolo') return 'YOLO ACTIVE';
	return automaticActive ? `YOLO ACTIVE · ${agent}` : agent;
}
