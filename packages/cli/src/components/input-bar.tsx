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
import {JevNotConfiguredError, toggleJevUsage, type AgentMetadata, type ConnectableProvider, type EffortLevel, type ModelPreferences} from '@codeyantram/shared';
import type {SessionOperation} from '../chat/session.js';
import {AgentSessionController} from '../chat/agent-session.js';
import {AgentPicker} from './agent-picker.js';
import {FALLBACK_AGENT_METADATA} from '../chat/agent-catalog.js';
import {ChatGPTAccountPicker} from './chatgpt-account-picker.js';
import {useChatGPTControls} from './use-chatgpt-controls.js';
import type {ChatGPTAccount, ChatGPTAccountModel} from '../chat/chatgpt.js';
import {useExportConfirmation} from './use-export-confirmation.js';

const INPUT_RESERVED_COLUMNS = 6;
type InputBarProps = {
	modelPreferences: ModelPreferences;
	chatgptModels?: readonly ChatGPTAccountModel[];
	onChatGPTCommand?: (command: string, profileId?: string, signal?: AbortSignal) => Promise<string>;
	onLoadChatGPTAccounts?: () => Promise<ChatGPTAccount[]>;
	onSaveProviderKey?: (provider: ConnectableProvider, apiKey: string) => Promise<void>;
	agentSession?: AgentSessionController;
	availableAgents?: readonly AgentMetadata[];
	agentDiagnostics?: readonly string[];
	refreshAgents?: () => Promise<void>;
	reloadAgents?: () => Promise<readonly {filePath?: string; message: string}[]>;
	onSelectModel: (id: string, effort?: EffortLevel) => Promise<void>;
	operation: SessionOperation;
	onSubmit: (text: string) => void;
	onCancel: () => void;
	onExport?: (filePath?: string) => void;
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
	const {modelPreferences, chatgptModels = [], onSelectModel, operation, agentSession, availableAgents = FALLBACK_AGENT_METADATA, agentDiagnostics, refreshAgents} = props;
	const [localAgentSession] = useState(() => new AgentSessionController({patch: false, command: false}));
	const activeAgentSession = agentSession ?? localAgentSession;
	const {columns} = useWindowSize();
	const controller = useInputBarController(props);
	const {isBusy, commandQuery, onSelectCommand, owner, palette, inputRevision, value, isEditing, handleChange, submitDraft} = controller;

	return (
		<Box flexDirection="column" width="100%">
			{!isBusy && <CommandPalette query={commandQuery} onSelect={onSelectCommand} onQueryChange={query => {if (query.includes(' ')) handleChange(`/${query}`);}} />}
			{!isBusy && controller.exportConfirmation}
			<InputPickers isBusy={isBusy} owner={owner} modelPreferences={modelPreferences} chatgptModels={chatgptModels} chatgptAccounts={controller.chatgptAccounts} onSelectChatGPTAccount={controller.selectChatGPTAccount} onSelectChatGPTLogin={() => onSelectCommand('/chatgpt login')} onSaveProviderKey={props.onSaveProviderKey} onSelectModel={onSelectModel} agentSession={activeAgentSession} availableAgents={availableAgents} agentDiagnostics={agentDiagnostics} refreshAgents={refreshAgents} />
			<InputStatus {...controller} operation={operation} />
			<Box borderStyle="round" borderColor={palette.border} paddingX={1} width="100%">
				<Text color={palette.prompt}>› </Text>
				<TextInput placeholder={'Okay, what did you do this time?'.slice(0, Math.max(0, columns - INPUT_RESERVED_COLUMNS))} key={`${inputRevision}:${owner}`} defaultValue={value} isDisabled={!isEditing || owner !== 'input-bar'} onChange={handleChange} onSubmit={submitDraft} />
			</Box>
		</Box>
	);
}

function useInputBarController({operation, onSubmit, onCancel, onExport, onClear, onCompact, onStatus, onInit, reloadAgents, onChatGPTCommand, onLoadChatGPTAccounts}: InputBarProps) {
	const [value, setValue] = useState('');
	const [inputRevision, setInputRevision] = useState(0);
	const [showHelp, setShowHelp] = useState(false);
	const {palette, notice, noticeTone, setNotice} = useTheme();
	const {owner, isOwner, push, pop} = useKeyboardOwner();
	const {exit} = useApp();
	const {isSavingJev, savingJev, toggleJev} = useJevToggle(setNotice);
	const chatgpt = useChatGPTControls({onCommand: onChatGPTCommand, onLoadAccounts: onLoadChatGPTAccounts});
	const chatExport = useExportConfirmation(onExport);
	const isRunningChatGPT = chatgpt.isRunning;
	const isLoadingAccounts = chatgpt.isLoadingAccounts;
	const isBusy = operation !== 'idle' || isSavingJev || isRunningChatGPT || isLoadingAccounts;
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
		dispatchCommand(command, {onInit, onStatus, onExport: chatExport.requestExport, onClear, onCompact, exit, push, setShowHelp, toggleJev, setNotice, reloadAgents, runChatGPT: chatgpt.run, openChatGPTAccountPicker: chatgpt.openAccountPicker});
	}

	const submitDraft = createDraftSubmit({owner, isOwner, isBusy, onSelectCommand, setNotice, setShowHelp, updateDraft, onSubmit});
	const handleChange = createDraftChange({value, isOwner, push, pop, setValue, setShowHelp, setNotice});

	useInputBarKeyboard({savingJev, isBusy, isEditing, isOwner, pop, setShowHelp, updateDraft, onCancel: () => {
		if (chatgpt.isRunning) chatgpt.cancel(); else onCancel();
	}});
	return {value, inputRevision, showHelp, isSavingJev, isRunningChatGPT, isLoadingAccounts, chatgptAccounts: chatgpt.accounts,
		selectChatGPTAccount: chatgpt.selectAccount,
		exportConfirmation: chatExport.confirmation,
		palette, notice, noticeTone, owner, isBusy, isEditing, commandQuery, onSelectCommand, handleChange, submitDraft};
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
			if (activeOwner === 'approval') break;
			pop(activeOwner);
			activeOwner = getOwner();
		}
	}, [isBusy, getOwner, pop, setShowHelp]);

}

function createDraftSubmit(context: Pick<DraftContext, 'owner' | 'isOwner' | 'isBusy' | 'onSelectCommand' | 'setNotice' | 'setShowHelp' | 'updateDraft' | 'onSubmit'>) {
	const {owner, isOwner, isBusy, onSelectCommand, setNotice, setShowHelp, updateDraft, onSubmit} = context;
	function submitDraft(text: string) {
		// The command palette owns Enter while it is open.
		if (owner !== 'input-bar' || !isOwner('input-bar') || isBusy || !text.trim()) return;
		if (text.trim().startsWith('/')) {
			onSelectCommand(text.trim());
			return;
		}
		setNotice(undefined);
		setShowHelp(false);
		updateDraft('');
		onSubmit(text);
	}

	return submitDraft;
}

function createDraftChange(context: Pick<DraftContext, 'isOwner' | 'push' | 'pop' | 'setValue' | 'setShowHelp' | 'setNotice'> & {value: string}) {
	const {value, isOwner, push, pop, setValue, setShowHelp, setNotice} = context;
	function updateCommandPalette(next: string) {
		if (next.startsWith('/') && !next.includes(' ') && !isOwner('command-palette')) {
			push('command-palette');
		} else if ((!next.startsWith('/') || next.includes(' ')) && isOwner('command-palette')) {
			pop('command-palette');
		}
	}

	function handleChange(next: string) {
		// Ignore TextInput's replay of unchanged values after a callback update.
		if (next === value) return;
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
			if (isOwner('input-bar') && key.escape) onCancel();
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

function dispatchCommand(command: string, actions: Pick<InputBarProps, 'onInit' | 'onStatus' | 'onClear' | 'onExport' | 'onCompact' | 'reloadAgents'> & Pick<DraftContext, 'push' | 'setShowHelp' | 'setNotice'> & {exit: () => void; toggleJev: () => Promise<void>; runChatGPT: (command: string, profileId?: string) => Promise<void>; openChatGPTAccountPicker: () => Promise<void>}) {
  const [base = '', sub, profileId] = command.trim().split(/\s+/);
  if (base.toLowerCase() === '/export') {
    dispatchExport(command, actions);
    return;
  }
  if (base.toLowerCase() === '/chatgpt') {
    if (sub?.toLowerCase() === 'use' && profileId === undefined) void actions.openChatGPTAccountPicker();
    else if (sub && ['login', 'logout', 'status', 'use'].includes(sub.toLowerCase())) void actions.runChatGPT(sub.toLowerCase(), profileId);
    else actions.setNotice('Use /chatgpt login [new|profile-id], /chatgpt status, /chatgpt logout, or /chatgpt use <profile-id>.', 'error');
    return;
  }
  const commands = new Map<string, () => void>([
    ['/init', actions.onInit], ['/status', actions.onStatus], ['/help', () => {actions.setShowHelp(true);}],
    ['/model', () => {actions.push('model-picker');}], ['/connect', () => {actions.push('provider-picker');}],
    ['/agent', () => {actions.push('agent-picker');}],
		['/discover', () => {void actions.reloadAgents?.().then(diagnostics => {
			actions.setNotice(diagnostics.length ? `Agent reload: ${diagnostics.map(item => `${item.filePath ?? 'file'}: ${item.message}`).join('; ')}` : 'Agents reloaded.');
			return null;
		}).catch(() => actions.setNotice('Could not reload agents.', 'error'));}],
    ['/jev', () => {void actions.toggleJev();}], ['/theme', () => {actions.push('theme-picker');}],
    ['/clear', actions.onClear], ['/compact', actions.onCompact], ['/exit', actions.exit],
  ]);
  const action = commands.get(command.toLowerCase());
  if (action) action();
  else actions.setNotice(`Unknown command: ${command}. Use /help to see available commands.`, 'error');
}

// oxlint-disable-next-line eslint/complexity -- The status message follows the existing operation and authentication states.
function InputStatus({isBusy, isSavingJev, isRunningChatGPT, isLoadingAccounts, operation, showHelp, notice, noticeTone, palette}: Pick<ReturnType<typeof useInputBarController>, 'isBusy' | 'isSavingJev' | 'isRunningChatGPT' | 'isLoadingAccounts' | 'showHelp' | 'notice' | 'noticeTone' | 'palette'> & {operation: SessionOperation}) {

	let spinnerLabel = 'Generating · Esc to cancel';
	if (isBusy) {
		if (isSavingJev) spinnerLabel = 'Saving JEV preference…';
		else if (isLoadingAccounts) spinnerLabel = 'Loading ChatGPT accounts…';
		else if (isRunningChatGPT) spinnerLabel = 'Waiting for ChatGPT sign-in · Esc to cancel';
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

function InputPickers({isBusy, owner, modelPreferences, chatgptModels, chatgptAccounts, onSelectChatGPTAccount, onSelectChatGPTLogin, onSaveProviderKey, onSelectModel, agentSession, availableAgents, agentDiagnostics, refreshAgents}: Pick<InputBarProps, 'modelPreferences' | 'chatgptModels' | 'onSaveProviderKey' | 'onSelectModel' | 'agentSession' | 'availableAgents' | 'agentDiagnostics' | 'refreshAgents'> & Pick<ReturnType<typeof useInputBarController>, 'isBusy' | 'owner'> & {chatgptAccounts: readonly ChatGPTAccount[]; onSelectChatGPTAccount: (id: string) => void; onSelectChatGPTLogin: () => void}) {
	if (isBusy) return null;
	return <>
			{owner === 'theme-picker' && <ThemePicker />}
			{(owner === 'model-picker' || owner === 'effort-picker') && (
				<ModelPicker preferences={modelPreferences} chatgptModels={chatgptModels} onSelect={onSelectModel} />
			)}
			{owner === 'chatgpt-account-picker' && <ChatGPTAccountPicker accounts={chatgptAccounts} onSelect={onSelectChatGPTAccount} />}
			{(owner === 'provider-picker' || owner === 'openai-auth-picker' || owner === 'api-key-input') &&
				<ProviderPicker onChatGPTLogin={onSelectChatGPTLogin} onSaveKey={onSaveProviderKey} openaiConnection={modelPreferences.openaiConnection} />}
			<AgentPickerSlot owner={owner} agentSession={agentSession} availableAgents={availableAgents} agentDiagnostics={agentDiagnostics} refreshAgents={refreshAgents} />
	</>;
}

function AgentPickerSlot({owner, agentSession, availableAgents, agentDiagnostics, refreshAgents}: Pick<InputBarProps, 'agentSession' | 'availableAgents' | 'agentDiagnostics' | 'refreshAgents'> &
	Pick<ReturnType<typeof useInputBarController>, 'owner'>) {
	if (!agentSession || (owner !== 'agent-picker' && owner !== 'yolo-confirmation')) return null;
	return <AgentPicker session={agentSession} agents={availableAgents ?? FALLBACK_AGENT_METADATA} diagnostics={agentDiagnostics} refresh={refreshAgents} />;
}

function dispatchExport(command: string, actions: Pick<InputBarProps, 'onExport'> & Pick<DraftContext, 'setNotice'>) {
  const filePath = command.trim().slice('/export'.length).trim();
  if (actions.onExport) actions.onExport(filePath || undefined);
  else actions.setNotice('Chat export is unavailable.', 'error');
}
