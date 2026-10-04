import React, {Component, type ReactNode} from 'react';
import {Text} from 'ink';
import {ProgressBar} from '@inkjs/ui';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {saveProviderApiKey, findSupportedChatModel} from '@codeyantram/shared';
import {KeyboardProvider, useKeyboardOwner, type KeyboardOwner} from '../../src/keyboard/provider.js';
import {ThemeProvider, useTheme} from '../../src/theme/provider.js';
import {konkanTheme} from '../../src/theme/builtins/index.js';
import {createThemeRegistry} from '../../src/theme/registry/registry.js';
import {saveThemePreference} from '../../src/theme/utils/index.js';
import {Picker} from '../../src/components/picker.js';
import {ThemePicker} from '../../src/components/theme-picker.js';
import {ModelPicker} from '../../src/components/model-picker.js';
import {ApiKeyInput} from '../../src/components/api-key-input.js';
import {CommandPalette} from '../../src/components/command-palette.js';
import {StatusBar} from '../../src/components/status-bar.js';
import {cleanupTerminal, renderTerminal} from '../helpers/terminal-ui.js';

type Selection = {onChange: (value: string) => void; isDisabled?: boolean; options: {value: string}[]};
const widgets = vi.hoisted(() => ({selects: [] as Selection[], passwords: [] as {onSubmit: (value: string) => void}[]}));

// A widget can deliver an effect callback after its owner or disabled state changed.
// Capture that boundary while keeping the real contexts and component behavior.
vi.mock('@inkjs/ui', async importOriginal => ({
	...await importOriginal<typeof import('@inkjs/ui')>(),
	Select: (props: Selection) => {widgets.selects.push(props); return null;},
	PasswordInput: (props: {onSubmit: (value: string) => void}) => {widgets.passwords.push(props); return null;},
}));
vi.mock('@codeyantram/shared', async importOriginal => {
	const original = await importOriginal<typeof import('@codeyantram/shared')>();
	return {...original, saveProviderApiKey: vi.fn(), findSupportedChatModel: vi.fn(original.findSupportedChatModel)};
});
vi.mock('../../src/theme/utils/index.js', () => ({saveThemePreference: vi.fn()}));

const registry = createThemeRegistry([{source: 'builtin', themes: [{source: 'builtin', theme: konkanTheme}]}]);
beforeEach(() => {
	widgets.selects.length = 0;
	widgets.passwords.length = 0;
	vi.mocked(saveProviderApiKey).mockResolvedValue(undefined);
	vi.mocked(saveThemePreference).mockImplementation(async id => id);
});
afterEach(cleanupTerminal);

function setup(node: ReactNode, initialThemeId = 'konkan') {
	let keyboard!: ReturnType<typeof useKeyboardOwner>;
	let theme!: ReturnType<typeof useTheme>;
	function Probe() {
		keyboard = useKeyboardOwner();
		theme = useTheme();
		return <Text>Owner:{keyboard.owner} Theme:{theme.selectedId}</Text>;
	}
	const ui = renderTerminal(<ThemeProvider registry={registry} initialThemeId={initialThemeId} colorDepth={0}>
		<KeyboardProvider><Probe />{node}</KeyboardProvider>
	</ThemeProvider>);
	return {
		...ui, keyboard: () => keyboard, theme: () => theme,
		async open(owner: Exclude<KeyboardOwner, 'input-bar'>) {
			await vi.waitFor(() => expect(keyboard).toBeDefined());
			keyboard.push(owner);
			await vi.waitFor(() => expect(ui.frame()).toContain(`Owner:${owner}`));
		},
	};
}
const selection = () => widgets.selects.at(-1)!;

describe('picker callback ownership', () => {
	it('ignores unknown options and callbacks arriving after another picker takes ownership', async () => {
		const onSelect = vi.fn();
		const ui = setup(<Picker owner="model-picker" title="Models" options={[{value: 'known', label: 'Known'}]} onSelect={onSelect} onCancel={vi.fn()} />);
		await ui.open('model-picker');
		const choose = selection().onChange;
		choose('unknown');
		expect(onSelect).not.toHaveBeenCalled();
		choose('known');
		expect(onSelect).toHaveBeenCalledExactlyOnceWith('known');
		ui.keyboard().push('effort-picker');
		choose('known');
		expect(onSelect).toHaveBeenCalledOnce();
	});

	it('ignores selection effects while the picker is disabled', async () => {
		const onSelect = vi.fn();
		const ui = setup(<Picker owner="model-picker" title="Models" options={[{value: 'known', label: 'Known'}]} isDisabled onSelect={onSelect} onCancel={vi.fn()} />);
		await ui.open('model-picker');
		selection().onChange('known');
		expect(onSelect).not.toHaveBeenCalled();
	});

	it('does not execute an old command-palette callback after ownership changes', async () => {
		const onSelect = vi.fn();
		const ui = setup(<CommandPalette onSelect={onSelect} />);
		await ui.open('command-palette');
		const choose = selection().onChange;
		ui.keyboard().push('model-picker');
		choose('/help');
		expect(onSelect).not.toHaveBeenCalled();
		expect(ui.keyboard().getOwner()).toBe('model-picker');
	});
});

describe('save callback guards', () => {
	it('ignores duplicate API-key submissions and submissions after ownership changes', async () => {
		let finish!: () => void;
		vi.mocked(saveProviderApiKey).mockReturnValueOnce(new Promise<void>(resolve => {finish = resolve;}));
		const saved = vi.fn();
		const ui = setup(<ApiKeyInput provider="openai" providerName="OpenAI" onSaved={saved} />);
		await ui.open('api-key-input');
		const submit = widgets.passwords.at(-1)!.onSubmit;
		submit('key');
		submit('duplicate');
		expect(saveProviderApiKey).toHaveBeenCalledExactlyOnceWith('openai', 'key');
		finish();
		await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
		submit('stale');
		expect(saveProviderApiKey).toHaveBeenCalledOnce();
	});

	it('ignores duplicate theme selections before the saving state renders', async () => {
		let finish!: (id: string) => void;
		vi.mocked(saveThemePreference).mockReturnValueOnce(new Promise<string>(resolve => {finish = resolve;}));
		const ui = setup(<ThemePicker />);
		await ui.open('theme-picker');
		const choose = selection().onChange;
		choose('konkan');
		choose('konkan');
		expect(saveThemePreference).toHaveBeenCalledOnce();
		finish('konkan');
		await vi.waitFor(() => expect(ui.keyboard().getOwner()).toBe('input-bar'));
	});

	it('ignores duplicate model saves and a stale model-selection effect during saving', async () => {
		let finish!: () => void;
		const onSelect = vi.fn(() => new Promise<void>(resolve => {finish = resolve;}));
		const ui = setup(<ModelPicker preferences={{modelId: 'gpt-6.1-sol', effortByModel: {'gpt-6.1-sol': 'high'}}} onSelect={onSelect} />);
		await ui.open('model-picker');
		const chooseModel = selection().onChange;
		chooseModel('gpt-6.1-sol');
		await vi.waitFor(() => expect(ui.frame()).toContain('Choose effort for gpt-6.1-sol'));
		const chooseEffort = selection().onChange;
		expect(selection().options[0]!.value).toBe('high');
		chooseEffort('high');
		chooseEffort('high');
		ui.keyboard().pop('effort-picker');
		chooseModel('gemma-4-31b-it');
		expect(onSelect).toHaveBeenCalledExactlyOnceWith('gpt-6.1-sol', 'high');
		finish();
		await vi.waitFor(() => expect(ui.keyboard().getOwner()).toBe('input-bar'));
	});

	it('keeps the model picker open if the selected model disappeared from the catalog', async () => {
		const onSelect = vi.fn();
		const ui = setup(<ModelPicker preferences={{modelId: 'gpt-6.1-sol', effortByModel: {}}} onSelect={onSelect} />);
		await ui.open('model-picker');
		vi.mocked(findSupportedChatModel).mockReturnValueOnce(undefined);
		selection().onChange('gpt-6.1-sol');
		expect(onSelect).not.toHaveBeenCalled();
		expect(ui.keyboard().getOwner()).toBe('model-picker');
	});
});

describe('theme and status presentation', () => {
	it('uses the fallback palette for an unknown initial theme and styles both progress segments', async () => {
		const ui = setup(<ProgressBar value={50} />, 'missing');
		await vi.waitFor(() => expect(ui.frame()).toContain('Owner:input-bar'));
		expect(ui.theme().palette).toEqual(Object.fromEntries(Object.keys(konkanTheme.colors).map(role => [role, undefined])));
		expect(ui.frame()).toContain('█');
	});

	it('shows a singular recent turn in the compacted context footer', async () => {
		const ui = setup(<StatusBar branch="main" model="gpt-6.1-sol" contextTurnCount={1}
			contextStatus={{modelId: 'gpt-6.1-sol', usedTokens: 0, contextWindow: 1_050_000, usedPercent: 0, remainingPercent: 100}} />);
		await vi.waitFor(() => expect(ui.frame()).toContain('Context: compacted · 1 recent turn'));
		expect(ui.frame()).not.toContain('1 recent turns');
	});
});

class ErrorBoundary extends Component<{children: ReactNode}, {message?: string}> {
	state: {message?: string} = {};
	static getDerivedStateFromError(error: Error) {return {message: error.message};}
	render() {return this.state.message ? <Text>{this.state.message}</Text> : this.props.children;}
}

describe('context requirements', () => {
	it.each([
		['theme', (): null => {useTheme(); return null;}, 'useTheme must be used inside ThemeProvider.'],
		['keyboard', (): null => {useKeyboardOwner(); return null;}, 'useKeyboardOwner must be used inside KeyboardProvider.'],
	] as const)('reports a useful error when the %s provider is missing', async (_name, Probe, message) => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const ui = renderTerminal(<ErrorBoundary><Probe /></ErrorBoundary>);
		await vi.waitFor(() => expect(ui.frame()).toContain(message));
	});
});
