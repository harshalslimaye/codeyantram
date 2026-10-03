import React, {useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {Spinner, StatusMessage, TextInput} from '@inkjs/ui';
import {CommandPalette} from './command-palette.js';
import {ThemePicker} from './theme-picker.js';
import {ModelPicker} from './model-picker.js';
import {ProviderPicker} from './provider-picker.js';
import {useTheme} from '../theme/provider.js';
import {useKeyboardOwner} from '../keyboard/provider.js';
import type {EffortLevel} from '@codeyantram/shared';
import type {ModelPreferences} from '../models/preferences.js';
import {COMMANDS} from '../lib/commands.js';

export function InputBar({modelPreferences, onSelectModel, isStreaming, onSubmit, onCancel, onClear}: {
	modelPreferences: ModelPreferences;
	onSelectModel: (id: string, effort?: EffortLevel) => Promise<void>;
	isStreaming: boolean;
	onSubmit: (text: string) => void;
	onCancel: () => void;
	onClear: () => void;
}) {
	const [value, setValue] = useState('');
	const [inputRevision, setInputRevision] = useState(0);
	const {palette, notice, noticeTone, setNotice} = useTheme();
	const {owner, isOwner, push, pop} = useKeyboardOwner();
	const {exit} = useApp();
	const isEditing = !isStreaming && (owner === 'input-bar' || owner === 'command-palette');
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
				setNotice(COMMANDS.map(item => `${item.command}: ${item.description}`).join('\n'));
				break;
			case '/model':
				push('model-picker');
				break;
			case '/connect':
				push('provider-picker');
				break;
			case '/theme':
				push('theme-picker');
				break;
			case '/clear':
				onClear();
				break;
			case '/exit':
				exit();
				break;
			default:
				setNotice(`Unknown command: ${command}. Use /help to see available commands.`, 'error');
				break;
		}
	}

	function submitDraft(text: string) {
		// The command palette owns Enter while it is open.
		if (owner !== 'input-bar' || !isOwner('input-bar') || isStreaming || !text.trim()) return;
		if (text.trim().startsWith('/')) {
			onSelectCommand(text.trim().toLowerCase());
			return;
		}
		setNotice(undefined);
		updateDraft('');
		onSubmit(text);
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
		if (!isOwner('input-bar') && !isOwner('command-palette')) return;
		if (key.escape) {
			if (isStreaming) onCancel();
			else if (isOwner('input-bar')) updateDraft('');
			else pop('command-palette');
			return;
		}

	}, {isActive: isEditing || isStreaming});

	return (
		<Box flexDirection="column" width="100%">
			<CommandPalette query={commandQuery} onSelect={onSelectCommand} />
			{owner === 'theme-picker' && <ThemePicker />}
			{(owner === 'model-picker' || owner === 'effort-picker') && (
				<ModelPicker preferences={modelPreferences} onSelect={onSelectModel} />
			)}
			{(owner === 'provider-picker' || owner === 'api-key-input') && <ProviderPicker />}
			<Box borderStyle="round" borderColor={palette.border} paddingX={1} width="100%">
				<Text color={palette.prompt}>› </Text>
				<TextInput key={inputRevision} defaultValue={value} isDisabled={!isEditing} onChange={handleChange} onSubmit={submitDraft} />
			</Box>
			{isStreaming ? <Spinner label="Generating · Esc to cancel" /> : <Text color={palette.muted}>Enter to send · PgUp/PgDn history · /help commands</Text>}
			{notice && <StatusMessage variant={noticeTone}>{notice}</StatusMessage>}
		</Box>
	);
}
