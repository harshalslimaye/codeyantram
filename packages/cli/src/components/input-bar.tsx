import React, {useEffect, useState} from 'react';
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
import type {SessionOperation} from '../chat/session.js';

export function InputBar({modelPreferences, onSelectModel, operation, onSubmit, onCancel, onClear, onCompact}: {
	modelPreferences: ModelPreferences;
	onSelectModel: (id: string, effort?: EffortLevel) => Promise<void>;
	operation: SessionOperation;
	onSubmit: (text: string) => void;
	onCancel: () => void;
	onClear: () => void;
	onCompact: () => void;
}) {
	const [value, setValue] = useState('');
	const [inputRevision, setInputRevision] = useState(0);
	const {palette, notice, noticeTone, setNotice} = useTheme();
	const {owner, getOwner, isOwner, push, pop} = useKeyboardOwner();
	const {exit} = useApp();
	const isBusy = operation !== 'idle';
	const isEditing = !isBusy && (owner === 'input-bar' || owner === 'command-palette');
	const commandQuery = value.startsWith('/') && value.length > 1 && !value.includes(' ')
		? value.slice(1)
		: undefined;

	// A programmatic operation may start while a picker is open. Close that flow
	// so it cannot accept input or leave a nested keyboard owner after cancellation.
	useEffect(() => {
		if (!isBusy) return;
		let activeOwner = getOwner();
		while (activeOwner !== 'input-bar') {
			pop(activeOwner);
			activeOwner = getOwner();
		}
	}, [isBusy, getOwner, pop]);

	function updateDraft(next: string) {
		setValue(next);
		setInputRevision(previous => previous + 1);
	}

	function onSelectCommand(command: string) {
		if (isBusy) return;
		updateDraft('');
		setNotice(undefined);
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
			case '/compact':
				onCompact();
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
		if (owner !== 'input-bar' || !isOwner('input-bar') || isBusy || !text.trim()) return;
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
		if (isBusy) {
			if (key.escape) onCancel();
			return;
		}
		if (!isOwner('input-bar') && !isOwner('command-palette')) return;
		if (key.escape) {
			if (isOwner('input-bar')) updateDraft('');
			else pop('command-palette');
			return;
		}

	}, {isActive: isEditing || isBusy});

	return (
		<Box flexDirection="column" width="100%">
			{!isBusy && <CommandPalette query={commandQuery} onSelect={onSelectCommand} />}
			{!isBusy && owner === 'theme-picker' && <ThemePicker />}
			{!isBusy && (owner === 'model-picker' || owner === 'effort-picker') && (
				<ModelPicker preferences={modelPreferences} onSelect={onSelectModel} />
			)}
			{!isBusy && (owner === 'provider-picker' || owner === 'api-key-input') && <ProviderPicker />}
			<Box flexDirection="column">
				{isBusy ? <Spinner label={operation === 'compact' ? 'Compacting conversation · Esc to cancel' : 'Generating · Esc to cancel'} />
				: <Text color={palette.muted}>Enter to send · Mouse/trackpad scroll history · /help commands</Text>}
				{notice && <StatusMessage variant={noticeTone}>{notice}</StatusMessage>}
			</Box>
			<Box borderStyle="round" borderColor={palette.border} paddingX={1} width="100%">
				<Text color={palette.prompt}>› </Text>
				<TextInput key={inputRevision} defaultValue={value} isDisabled={!isEditing} onChange={handleChange} onSubmit={submitDraft} />
			</Box>
		</Box>
	);
}
