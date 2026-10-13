import React from 'react';
import { Box, Text, useWindowSize } from 'ink';
import {findSupportedChatModel, type EffortLevel, type OpenAIConnection} from '@codeyantram/shared';
import {useTheme} from '../theme/provider.js';
import { Badge } from '@inkjs/ui';
import type {ContextStatus} from '../chat/context.js';
import {formatContextPercent} from './session-status.js';
import type {CliAgentId} from '../chat/agent-session.js';

const SECONDS_PER_MINUTE = 60;

// oxlint-disable-next-line eslint/complexity -- The display handles known catalog models and account-specific ChatGPT models.
export function StatusBar({ branch, agent = 'ask', automaticActive = false, model, openaiConnection = 'api-key', effort, contextTurnCount, contextStatus }: { branch: string; agent?: CliAgentId; automaticActive?: boolean; model: string; openaiConnection?: OpenAIConnection; effort?: EffortLevel; contextTurnCount?: number; contextStatus: ContextStatus }) {
	const {palette} = useTheme();
	const {columns} = useWindowSize();
	const isOpenAI = findSupportedChatModel(model)?.provider === 'openai' || (findSupportedChatModel(model) === undefined && openaiConnection === 'chatgpt');
	let connectionLabel = 'Model';
	if (isOpenAI) connectionLabel = openaiConnection === 'chatgpt' ? 'ChatGPT plan' : 'API key';
	const modelLabel = `${isOpenAI ? `${connectionLabel} · ` : ''}${model}${effort !== undefined ? ` » ${effort}` : ''}`;
	const agentLabel = displayAgent(agent, automaticActive);

	return (
		<Box width="100%" paddingX={1} flexDirection="column">
			<Box width="100%">
				<Badge color={palette.primary}><Text color={palette.text}>git:{branch}</Text></Badge>
				<Box marginX={1} flexShrink={0}>
					<Text underline color={automaticActive || agent === 'yolo' ? palette.prompt : palette.muted}>{agentLabel}</Text>
				</Box>
				<Box marginX={1} flexShrink={0}>
					<Text color={palette.muted}>{columns >= SECONDS_PER_MINUTE ? 'Context' : 'Ctx'} {contextStatus.contextWindow > 0 ? `~${formatContextPercent(contextStatus.usedPercent)}%${columns >= SECONDS_PER_MINUTE ? ' used' : ''}` : 'window unknown'}</Text>
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
	if (agent === 'yolo') return 'YOLO';
	return automaticActive ? `YOLO · ${agent}` : agent;
}
