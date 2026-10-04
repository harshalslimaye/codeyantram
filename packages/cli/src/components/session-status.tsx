import React from 'react';
import {Box, Text} from 'ink';
import {ProgressBar} from '@inkjs/ui';
import type {ContextStatus} from '../chat/context.js';
import {useTheme} from '../theme/provider.js';

const percentFormatter = new Intl.NumberFormat('en-US', {maximumFractionDigits: 1});
const tokenFormatter = new Intl.NumberFormat('en-US');

export function formatContextPercent(value: number): string {
	return percentFormatter.format(value);
}

export function SessionStatus({status}: {status: ContextStatus}) {
	const {palette} = useTheme();
	return (
		<Box borderStyle="round" borderColor={palette.border} paddingX={1} flexDirection="column" flexShrink={0}>
			<Text bold color={palette.primary}>Session status</Text>
			<Text color={palette.text}>Model    {status.modelId}</Text>
			<Text color={palette.text}>Context  ~{tokenFormatter.format(status.usedTokens)} / {tokenFormatter.format(status.contextWindow)} tokens</Text>
			<Box columnGap={1}>
				<Box flexGrow={1} flexBasis={0}><ProgressBar value={status.usedPercent} /></Box>
				<Text color={palette.muted}>~{formatContextPercent(status.usedPercent)}% used</Text>
			</Box>
			<Text color={palette.muted}>~{formatContextPercent(status.remainingPercent)}% remaining</Text>
		</Box>
	);
}
