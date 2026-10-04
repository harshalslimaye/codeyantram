import React from 'react';
import {Box, Text} from 'ink';
import {UnorderedList} from '@inkjs/ui';
import {COMMANDS} from '../lib/commands.js';
import {useTheme} from '../theme/provider.js';

export function Help() {
	const {palette} = useTheme();
	const commandWidth = Math.max(...COMMANDS.map(({command}) => command.length));
	return (
		<Box flexDirection="column">
			<Text bold color={palette.primary}>Available commands</Text>
			<UnorderedList>
				{COMMANDS.map(({command, description}) => (
					<UnorderedList.Item key={command}>
						<Box>
							<Box width={commandWidth} marginRight={2} flexShrink={0}>
								<Text bold color={palette.prompt}>{command}</Text>
							</Box>
							<Box flexGrow={1} flexShrink={1}>
								<Text color={palette.text}>{description}</Text>
							</Box>
						</Box>
					</UnorderedList.Item>
				))}
			</UnorderedList>
		</Box>
	);
}
