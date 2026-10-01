import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {Cursor} from './cursor.js';

const COMMANDS = [
	{command: '/help', description: 'Show available commands'},
	{command: '/model', description: 'Change the active model'},
	{command: '/clear', description: 'Clear the conversation'},
	{command: '/exit', description: 'Exit Codeyantram'},
];

function CommandPalette() {
	return (
		<Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} width="100%">
			<Text color="gray">Commands</Text>
			{COMMANDS.map(item => (
				<Box key={item.command}>
					<Text color="cyan" bold>{item.command.padEnd(8)}</Text>
					<Text color="gray">{item.description}</Text>
				</Box>
			))}
		</Box>
	);
}

export function InputBar() {
	const [value, setValue] = useState('');

	useInput((input, key) => {
		if (key.backspace || key.delete) {
			setValue(previousValue => previousValue.slice(0, -1));
			return;
		}

		if (!key.return && !key.escape && input) {
			setValue(previousValue => previousValue + input);
		}
	});

	return (
		<Box flexDirection="column" width="100%">
			{value === '/' && <CommandPalette />}
			<Box borderStyle="round" borderColor="gray" paddingX={1} width="100%">
				<Text color="cyan">› </Text>
				<Text>{value}</Text>
				<Cursor />
			</Box>
		</Box>
	);
}
