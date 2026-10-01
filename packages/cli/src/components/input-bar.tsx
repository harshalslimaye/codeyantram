import React, {useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {StatusMessage, TextInput} from '@inkjs/ui';
import {CommandPalette} from './command-palette.js';
import {ThemePicker} from './theme-picker.js';
import {useTheme} from '../theme/provider.js';
import {useKeyboardOwner} from '../keyboard/provider.js';

export function InputBar() {
	const [value, setValue] = useState('');
	const [inputRevision, setInputRevision] = useState(0);
	const {palette, notice, noticeTone, setNotice} = useTheme();
	const {owner, isOwner, push, pop} = useKeyboardOwner();
	const {exit} = useApp();
	const commandQuery = value.startsWith('/') && value.length > 1 && !value.includes(' ')
		? value.slice(1)
		: undefined;

	function updateDraft(next: string) {
		setValue(next);
		setInputRevision(previous => previous + 1);
	}

	function onSelectCommand(command: string) {
		updateDraft('');
		switch (command) {
			case '/help':
				// Handle help command
				break;
			case '/model':
				// Handle model command
				break;
			case '/theme':
				push('theme-picker');
				break;
			case '/clear':
				// Handle clear command
				break;
			case '/exit':
				exit();
				break;
			default:
				// Handle unknown command
				break;
		}
	}

	function updateCommandPalette(next: string) {
		if (next.startsWith('/') && !next.includes(' ') && !isOwner('command-palette')) {
			push('command-palette');
		} else if ((!next.startsWith('/') || next.includes(' ')) && isOwner('command-palette')) {
			pop('command-palette');
		}
	}

	function handleChange(next: string) {
		setValue(next);
		setNotice(undefined);
		updateCommandPalette(next);
	}

	useInput((_input, key) => {
		if (key.escape) {
			if (isOwner('input-bar')) updateDraft('');
			else pop('command-palette');
			return;
		}

	}, {isActive: owner !== 'theme-picker'});

	return (
		<Box flexDirection="column" width="100%">
			<CommandPalette query={commandQuery} onSelect={onSelectCommand} />
			{owner === 'theme-picker' && <ThemePicker />}
			<Box borderStyle="round" borderColor={palette.border} paddingX={1} width="100%">
				<Text color={palette.prompt}>› </Text>
				<TextInput key={inputRevision} defaultValue={value} isDisabled={owner === 'theme-picker'} onChange={handleChange} />
			</Box>
			{notice && <StatusMessage variant={noticeTone}>{notice}</StatusMessage>}
		</Box>
	);
}
