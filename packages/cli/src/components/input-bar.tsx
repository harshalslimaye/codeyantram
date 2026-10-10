import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useApp, useInput, useWindowSize} from 'ink';
import {Spinner, StatusMessage, TextInput} from '@inkjs/ui';
import {CommandPalette} from './command-palette.js';
import {ThemePicker} from './theme-picker.js';
import {ModelPicker} from './model-picker.js';
import {ProviderPicker} from './provider-picker.js';
import {Help} from './help.js';
import {useTheme} from '../theme/provider.js';
import {useKeyboardOwner} from '../keyboard/provider.js';
import {JevNotConfiguredError, toggleJevUsage, type EffortLevel, type ModelPreferences} from '@codeyantram/shared';
import type {SessionOperation} from '../chat/session.js';

const INPUT_RESERVED_COLUMNS = 6;

export function InputBar({modelPreferences, onSelectModel, operation, onSubmit, onCancel, onClear, onCompact, onStatus, onInit}: {
	modelPreferences: ModelPreferences;
	onSelectModel: (id: string, effort?: EffortLevel) => Promise<void>;
	operation: SessionOperation;
	onSubmit: (text: string) => void;
	onCancel: () => void;
	onClear: () => void;
	onCompact: () => void;
	onStatus: () => void;
	onInit: () => void;
}) {
	const {columns} = useWindowSize();
	const [value, setValue] = useState('');
	const [inputRevision, setInputRevision] = useState(0);
	const [showHelp, setShowHelp] = useState(false);
	const [isSavingJev, setIsSavingJev] = useState(false);
	const savingJev = useRef(false);
	const mounted = useRef(true);
	const {palette, notice, noticeTone, setNotice} = useTheme();
	const {owner, getOwner, isOwner, push, pop} = useKeyboardOwner();
	const {exit} = useApp();
	const isBusy = operation !== 'idle' || isSavingJev;
	const isEditing = !isBusy && (owner === 'input-bar' || owner === 'command-palette');
	const commandQuery = value.startsWith('/') && value.length > 1 && !value.includes(' ')
		? value.slice(1)
		: undefined;

	useEffect(() => {
		mounted.current = true;
		return () => { mounted.current = false; };
	}, []);

	async function toggleJev() {
		if (savingJev.current) return;
		savingJev.current = true;
		setIsSavingJev(true);
		try {
			const settings = await toggleJevUsage();
			if (mounted.current) setNotice(`JEV usage ${settings.enabled ? 'enabled' : 'disabled'}; saved to user config.`);
		} catch (error) {
			if (mounted.current) setNotice(error instanceof JevNotConfiguredError ? error.message : 'Could not update JEV usage. Check your user config and try again.', 'error');
		} finally {
			savingJev.current = false;
			if (mounted.current) setIsSavingJev(false);
		}
	}

	// A programmatic operation may start while a picker is open. Close that flow
	// so it cannot accept input or leave a nested keyboard owner after cancellation.
	useEffect(() => {
		if (!isBusy) return;
		setShowHelp(false);
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
		if (isBusy || savingJev.current) return;
		updateDraft('');
		setNotice(undefined);
		setShowHelp(false);
		switch (command) {
			case '/init':
				onInit();
				break;
			case '/status':
				onStatus();
				break;
			case '/help':
				setShowHelp(true);
				break;
			case '/model':
				push('model-picker');
				break;
			case '/connect':
				push('provider-picker');
				break;
			case '/jev':
				void toggleJev();
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
		if (owner !== 'input-bar' || !isOwner('input-bar') || isBusy || savingJev.current || !text.trim()) return;
		if (text.trim().startsWith('/')) {
			onSelectCommand(text.trim().toLowerCase());
			return;
		}
		setNotice(undefined);
		setShowHelp(false);
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
		setShowHelp(false);
		setNotice(undefined);
		updateCommandPalette(next);
	}

	useInput((_input, key) => {
		if (savingJev.current) return;
		if (isBusy) {
			if (key.escape) onCancel();
			return;
		}
		if (!isOwner('input-bar') && !isOwner('command-palette')) return;
		if (key.escape) {
			setShowHelp(false);
			if (isOwner('input-bar')) updateDraft('');
			else pop('command-palette');
			return;
		}

	}, {isActive: isEditing || isBusy});

	let spinnerLabel = 'Generating · Esc to cancel';
	if (isBusy) {
		if (isSavingJev) spinnerLabel = 'Saving JEV preference…';
		else if (operation === 'init') spinnerLabel = 'Initializing graph · Esc to cancel';
		else if (operation === 'compact') spinnerLabel = 'Compacting conversation · Esc to cancel';
	}

	return (
		<Box flexDirection="column" width="100%">
			{!isBusy && <CommandPalette query={commandQuery} onSelect={onSelectCommand} />}
			{!isBusy && owner === 'theme-picker' && <ThemePicker />}
			{!isBusy && (owner === 'model-picker' || owner === 'effort-picker') && (
				<ModelPicker preferences={modelPreferences} onSelect={onSelectModel} />
			)}
			{!isBusy && (owner === 'provider-picker' || owner === 'api-key-input') && <ProviderPicker />}
			<Box flexDirection="column">
				{isBusy ? <Spinner label={spinnerLabel} />
				: <Text color={palette.muted}>Enter to send · Mouse/trackpad scroll history · /help commands</Text>}
				{showHelp && !isBusy && <Help />}
				{(notice !== undefined && notice !== '') && <StatusMessage variant={noticeTone}>{notice}</StatusMessage>}
			</Box>
			<Box borderStyle="round" borderColor={palette.border} paddingX={1} width="100%">
				<Text color={palette.prompt}>› </Text>
				<TextInput placeholder={'Okay, what did you do this time?'.slice(0, Math.max(0, columns - INPUT_RESERVED_COLUMNS))} key={inputRevision} defaultValue={value} isDisabled={!isEditing} onChange={handleChange} onSubmit={submitDraft} />
			</Box>
		</Box>
	);
}
