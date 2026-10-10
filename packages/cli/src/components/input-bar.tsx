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

type InputBarProps = {
	modelPreferences: ModelPreferences;
	onSelectModel: (id: string, effort?: EffortLevel) => Promise<void>;
	operation: SessionOperation;
	onSubmit: (text: string) => void;
	onCancel: () => void;
	onClear: () => void;
	onCompact: () => void;
	onStatus: () => void;
	onInit: () => void;
};

type DraftContext = {
  owner: ReturnType<typeof useKeyboardOwner>['owner'];
  isOwner: ReturnType<typeof useKeyboardOwner>['isOwner'];
  push: ReturnType<typeof useKeyboardOwner>['push'];
  pop: ReturnType<typeof useKeyboardOwner>['pop'];
  isBusy: boolean; isEditing: boolean; savingJev: React.RefObject<boolean>;
  setNotice: ReturnType<typeof useTheme>['setNotice'];
  setShowHelp: React.Dispatch<React.SetStateAction<boolean>>;
  setValue: React.Dispatch<React.SetStateAction<string>>;
  updateDraft: (text: string) => void;
  onSelectCommand: (command: string) => void;
  onSubmit: (text: string) => void; onCancel: () => void;
};

export function InputBar(props: InputBarProps) {
	const {modelPreferences, onSelectModel, operation} = props;
	const {columns} = useWindowSize();
	const controller = useInputBarController(props);
	const {isBusy, commandQuery, onSelectCommand, owner, palette, inputRevision, value, isEditing, handleChange, submitDraft} = controller;

	return (
		<Box flexDirection="column" width="100%">
			{!isBusy && <CommandPalette query={commandQuery} onSelect={onSelectCommand} />}
			<InputPickers isBusy={isBusy} owner={owner} modelPreferences={modelPreferences} onSelectModel={onSelectModel} />
			<InputStatus {...controller} operation={operation} />
			<Box borderStyle="round" borderColor={palette.border} paddingX={1} width="100%">
				<Text color={palette.prompt}>› </Text>
				<TextInput placeholder={'Okay, what did you do this time?'.slice(0, Math.max(0, columns - INPUT_RESERVED_COLUMNS))} key={inputRevision} defaultValue={value} isDisabled={!isEditing} onChange={handleChange} onSubmit={submitDraft} />
			</Box>
		</Box>
	);
}

function useInputBarController({operation, onSubmit, onCancel, onClear, onCompact, onStatus, onInit}: InputBarProps) {
	const [value, setValue] = useState('');
	const [inputRevision, setInputRevision] = useState(0);
	const [showHelp, setShowHelp] = useState(false);
	const {palette, notice, noticeTone, setNotice} = useTheme();
	const {owner, isOwner, push, pop} = useKeyboardOwner();
	const {exit} = useApp();
	const {isSavingJev, savingJev, toggleJev} = useJevToggle(setNotice);
	const isBusy = operation !== 'idle' || isSavingJev;
	const isEditing = !isBusy && (owner === 'input-bar' || owner === 'command-palette');
	const commandQuery = value.startsWith('/') && value.length > 1 && !value.includes(' ')
		? value.slice(1)
		: undefined;

	useClosePickerOnBusy(isBusy, setShowHelp);

	function updateDraft(next: string) {
		setValue(next);
		setInputRevision(previous => previous + 1);
	}

	function onSelectCommand(command: string) {
		if (isBusy || savingJev.current) return;
		updateDraft('');
		setNotice(undefined);
		setShowHelp(false);
		dispatchCommand(command, {onInit, onStatus, onClear, onCompact, exit, push, setShowHelp, toggleJev, setNotice});
	}

	const submitDraft = createDraftSubmit({owner, isOwner, isBusy, savingJev, onSelectCommand, setNotice, setShowHelp, updateDraft, onSubmit});
	const handleChange = createDraftChange({isOwner, push, pop, setValue, setShowHelp, setNotice});

	useInputBarKeyboard({savingJev, isBusy, isEditing, isOwner, pop, setShowHelp, updateDraft, onCancel});
	return {value, inputRevision, showHelp, isSavingJev, palette, notice, noticeTone, owner, isBusy, isEditing, commandQuery, onSelectCommand, handleChange, submitDraft};
}

function useJevToggle(setNotice: ReturnType<typeof useTheme>['setNotice']) {
	const [isSavingJev, setIsSavingJev] = useState(false);
	const savingJev = useRef(false);
	const mounted = useRef(true);
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

	return {isSavingJev, savingJev, toggleJev};
}

function useClosePickerOnBusy(isBusy: boolean, setShowHelp: DraftContext['setShowHelp']) {
	const {getOwner, pop} = useKeyboardOwner();
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
	}, [isBusy, getOwner, pop, setShowHelp]);

}

function createDraftSubmit(context: Pick<DraftContext, 'owner' | 'isOwner' | 'isBusy' | 'savingJev' | 'onSelectCommand' | 'setNotice' | 'setShowHelp' | 'updateDraft' | 'onSubmit'>) {
	const {owner, isOwner, isBusy, savingJev, onSelectCommand, setNotice, setShowHelp, updateDraft, onSubmit} = context;
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

	return submitDraft;
}

function createDraftChange(context: Pick<DraftContext, 'isOwner' | 'push' | 'pop' | 'setValue' | 'setShowHelp' | 'setNotice'>) {
	const {isOwner, push, pop, setValue, setShowHelp, setNotice} = context;
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

	return handleChange;
}

function useInputBarKeyboard(context: Pick<DraftContext, 'savingJev' | 'isBusy' | 'isEditing' | 'isOwner' | 'pop' | 'setShowHelp' | 'updateDraft' | 'onCancel'>) {
	const {savingJev, isBusy, isEditing, isOwner, pop, setShowHelp, updateDraft, onCancel} = context;
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
}

function dispatchCommand(command: string, actions: Pick<InputBarProps, 'onInit' | 'onStatus' | 'onClear' | 'onCompact'> & Pick<DraftContext, 'push' | 'setShowHelp' | 'setNotice'> & {exit: () => void; toggleJev: () => Promise<void>}) {
  const commands = new Map<string, () => void>([
    ['/init', actions.onInit], ['/status', actions.onStatus], ['/help', () => {actions.setShowHelp(true);}],
    ['/model', () => {actions.push('model-picker');}], ['/connect', () => {actions.push('provider-picker');}],
    ['/jev', () => {void actions.toggleJev();}], ['/theme', () => {actions.push('theme-picker');}],
    ['/clear', actions.onClear], ['/compact', actions.onCompact], ['/exit', actions.exit],
  ]);
  const action = commands.get(command);
  if (action) action();
  else actions.setNotice(`Unknown command: ${command}. Use /help to see available commands.`, 'error');
}

function InputStatus({isBusy, isSavingJev, operation, showHelp, notice, noticeTone, palette}: Pick<ReturnType<typeof useInputBarController>, 'isBusy' | 'isSavingJev' | 'showHelp' | 'notice' | 'noticeTone' | 'palette'> & {operation: SessionOperation}) {

	let spinnerLabel = 'Generating · Esc to cancel';
	if (isBusy) {
		if (isSavingJev) spinnerLabel = 'Saving JEV preference…';
		else if (operation === 'init') spinnerLabel = 'Initializing graph · Esc to cancel';
		else if (operation === 'compact') spinnerLabel = 'Compacting conversation · Esc to cancel';
	}

	return (
			<Box flexDirection="column">
				{isBusy ? <Spinner label={spinnerLabel} />
				: <Text color={palette.muted}>Enter to send · Mouse/trackpad scroll history · /help commands</Text>}
				{showHelp && !isBusy && <Help />}
				{(notice !== undefined && notice !== '') && <StatusMessage variant={noticeTone}>{notice}</StatusMessage>}
			</Box>
	);
}

function InputPickers({isBusy, owner, modelPreferences, onSelectModel}: Pick<InputBarProps, 'modelPreferences' | 'onSelectModel'> & Pick<ReturnType<typeof useInputBarController>, 'isBusy' | 'owner'>) {
	if (isBusy) return null;
	return <>
			{owner === 'theme-picker' && <ThemePicker />}
			{(owner === 'model-picker' || owner === 'effort-picker') && (
				<ModelPicker preferences={modelPreferences} onSelect={onSelectModel} />
			)}
			{(owner === 'provider-picker' || owner === 'api-key-input') && <ProviderPicker />}
	</>;
}
