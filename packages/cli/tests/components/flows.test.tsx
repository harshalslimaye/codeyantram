import {requireValue, requestBody, parseJson} from '../../../shared/tests/helpers.js';
import type {InitTransport} from '../../src/chat/session.js';
import type * as SharedModule from '@codeyantram/shared';
import type * as ThemeUtilsModule from '../../src/theme/utils/index.js';
import React, {useEffect} from 'react';
import {Text} from 'ink';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {JevNotConfiguredError, readConfiguredProviders, readJevConfiguration, saveModelPreference, saveProviderApiKey, toggleJevUsage, type SupportedChatModelId} from '@codeyantram/shared';
import {InputBar} from '../../src/components/input-bar.js';
import {App} from '../../src/app.js';
import {KeyboardProvider, useKeyboardOwner} from '../../src/keyboard/provider.js';
import {ThemeProvider, useTheme} from '../../src/theme/provider.js';
import {BUILTIN_THEMES} from '../../src/theme/builtins/index.js';
import {createThemeRegistry} from '../../src/theme/registry/registry.js';
import {saveThemePreference} from '../../src/theme/utils/index.js';
import {cleanupTerminal, renderTerminal} from '../helpers/terminal-ui.js';
import {getGitBranch} from '../../src/lib/utils.js';

vi.mock('../../src/lib/utils.js', () => ({getGitBranch: vi.fn<typeof getGitBranch>(() => 'project-branch')}));

vi.mock('@codeyantram/shared', async importOriginal => ({
	...await importOriginal<typeof SharedModule>(),
	readConfiguredProviders: vi.fn<typeof readConfiguredProviders>(), saveModelPreference: vi.fn<typeof saveModelPreference>(), saveProviderApiKey: vi.fn<typeof saveProviderApiKey>(),
	readJevConfiguration: vi.fn<typeof readJevConfiguration>(), toggleJevUsage: vi.fn<typeof toggleJevUsage>(),
}));
vi.mock('../../src/theme/utils/index.js', async importOriginal => ({
	...await importOriginal<typeof ThemeUtilsModule>(), saveThemePreference: vi.fn<typeof saveThemePreference>(),
}));

beforeEach(() => {
	vi.mocked(readConfiguredProviders).mockResolvedValue([]);
	vi.mocked(readJevConfiguration).mockResolvedValue({enabled: false, configured: false});
	vi.mocked(toggleJevUsage).mockResolvedValue({enabled: true, configured: true});
	vi.mocked(saveProviderApiKey).mockResolvedValue(undefined);
	vi.mocked(saveThemePreference).mockImplementation(async id => id);
});
afterEach(cleanupTerminal);
afterEach(() => vi.unstubAllGlobals());

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
	return {promise, resolve, reject};
}

function setup(modelId: SupportedChatModelId = 'gpt-6.1-sol') {
	const registry = createThemeRegistry([{source: 'builtin', themes: BUILTIN_THEMES.map(theme => ({source: 'builtin', theme}))}]);
	const onSelectModel = vi.fn<(model: string, effort?: string) => Promise<void>>(async (_id: string, _effort?: string) => {});
	const onSubmit = vi.fn<(text: string) => void>();
	let keyboard!: ReturnType<typeof useKeyboardOwner>;
	let theme!: ReturnType<typeof useTheme>;
	function Probe() {
		const currentKeyboard = useKeyboardOwner();
		const currentTheme = useTheme();
		useEffect(() => {keyboard = currentKeyboard; theme = currentTheme;}, [currentKeyboard, currentTheme]);
		return <Text>Owner:{currentKeyboard.owner} Theme:{currentTheme.selectedId}</Text>;
	}
	const ui = renderTerminal(
		<ThemeProvider registry={registry} initialThemeId="konkan" colorDepth={0}>
			<KeyboardProvider>
				<Probe />
				<InputBar modelPreferences={{modelId, effortByModel: {}}} onSelectModel={onSelectModel} operation="idle"
					onSubmit={onSubmit} onCancel={vi.fn<() => void>()} onClear={vi.fn<() => void>()} onCompact={vi.fn<() => void>()} onStatus={vi.fn<() => void>()} onInit={vi.fn<() => void>()} />
			</KeyboardProvider>
		</ThemeProvider>,
	);
	return {...ui, onSelectModel, onSubmit, keyboard: () => keyboard, theme: () => theme};
}

type UI = ReturnType<typeof setup>;
async function command(ui: UI, name: string, title: string) {
	await vi.waitFor(() => expect(ui.frame()).toContain('Enter to send'));
	ui.stdin.write(name);
	await vi.waitFor(() => expect(ui.frame()).toContain('Commands ·'));
	await ui.flush();
	ui.stdin.write('\r');
	await vi.waitFor(() => expect(ui.frame()).toContain(title));
}
async function escape(ui: UI, next: string) {
	ui.stdin.write('\x1b');
	await vi.waitFor(() => expect(ui.frame()).toContain(next));
}
async function settleEscape(ui: UI) {
	// The terminal's 30ms CSI timeout is followed by Ink's 20ms Escape timeout.
	await new Promise(resolve => setTimeout(resolve, 60));
	await ui.flush();
}
async function chooseProvider(ui: UI) {
	await command(ui, '/connect', 'Choose a provider');
	await vi.waitFor(() => expect(ui.frame()).not.toContain('Loading providers'));
	ui.stdin.write('\r');
	await vi.waitFor(() => expect(ui.frame()).toContain('Enter API key for Anthropic'));
}

describe('provider connection flow', () => {
	it('configures TypeSafe through masked key entry independently of coding-model selection', async () => {
		vi.mocked(readJevConfiguration).mockResolvedValue({enabled: false, configured: true});
		const ui = setup();
		await command(ui, '/connect', 'Choose a provider');
		await vi.waitFor(() => expect(ui.frame()).toContain('TypeSafe (JEV) · configured'));
		for (let index = 0; index < 3; index++) {
			ui.stdin.write('\x1b[B');
			await ui.flush();
		}
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Enter API key for TypeSafe (JEV)'));
		ui.stdin.write('secret-jev-key');
		await ui.flush();
		expect(ui.frame()).not.toContain('secret-jev-key');
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('TypeSafe (JEV) API key saved'));
		expect(saveProviderApiKey).toHaveBeenCalledExactlyOnceWith('typesafe', 'secret-jev-key');
		expect(toggleJevUsage).not.toHaveBeenCalled();
		await command(ui, '/model', 'Choose a model');
		expect(ui.frame()).not.toMatch(/JEV|jev-latest|TypeSafe/);
	});

	it('shows configured providers, masks and saves a key, then restores chat input', async () => {
		vi.mocked(readConfiguredProviders).mockResolvedValue(['google']);
		const ui = setup();
		await command(ui, '/connect', 'Choose a provider');
		await vi.waitFor(() => expect(ui.frame()).toContain('Google · configured'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Enter API key for Anthropic'));
		ui.stdin.write('secret-test-key');
		await ui.flush();
		expect(ui.frame()).not.toContain('secret-test-key');
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Anthropic API key saved to user config.'));
		expect(saveProviderApiKey).toHaveBeenCalledExactlyOnceWith('anthropic', 'secret-test-key');
		expect(ui.keyboard().getOwner()).toBe('input-bar');
		ui.stdin.write('Hello');
		await vi.waitFor(() => expect(ui.frame()).toContain('Hello'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.onSubmit).toHaveBeenCalledExactlyOnceWith('Hello'));
	});

	it('rejects blank keys and returns from key entry to provider selection on Escape', async () => {
		const ui = setup();
		await chooseProvider(ui);
		ui.stdin.write('   ');
		await ui.flush();
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Enter an API key.'));
		expect(saveProviderApiKey).not.toHaveBeenCalled();
		await escape(ui, 'Choose a provider');
		expect(ui.frame()).not.toContain('Enter an API key.');
		await escape(ui, 'Owner:input-bar');
	});

	it('keeps key entry open on save failure and lets the user retry', async () => {
		vi.mocked(saveProviderApiKey).mockRejectedValueOnce(new Error('disk full'));
		const ui = setup();
		await chooseProvider(ui);
		ui.stdin.write('test-key');
		await ui.flush();
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Could not save the API key.'));
		expect(ui.keyboard().getOwner()).toBe('api-key-input');
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Anthropic API key saved'));
		expect(saveProviderApiKey).toHaveBeenCalledTimes(2);
	});

	it('disables duplicate submission and cancellation while saving', async () => {
		const saving = deferred<void>();
		vi.mocked(saveProviderApiKey).mockReturnValueOnce(saving.promise);
		const ui = setup();
		await chooseProvider(ui);
		ui.stdin.write('test-key');
		await ui.flush();
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Saving API key'));
		ui.stdin.write('\r\x1b');
		await settleEscape(ui);
		expect(saveProviderApiKey).toHaveBeenCalledOnce();
		expect(ui.keyboard().getOwner()).toBe('api-key-input');
		saving.resolve();
		await vi.waitFor(() => expect(ui.frame()).toContain('Anthropic API key saved'));
	});

	it('disables selection until provider loading finishes and reports a read failure', async () => {
		const loading = deferred<[]>();
		vi.mocked(readConfiguredProviders).mockReturnValueOnce(loading.promise);
		const ui = setup();
		await command(ui, '/connect', 'Loading providers');
		ui.stdin.write('\r\x1b');
		await settleEscape(ui);
		expect(ui.keyboard().getOwner()).toBe('provider-picker');
		loading.reject(new Error('read failed'));
		await vi.waitFor(() => expect(ui.frame()).toContain('Could not read provider configuration.'));
		await vi.waitFor(() => expect(ui.frame()).not.toContain('Loading providers'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Enter API key for Anthropic'));
		expect(ui.frame()).not.toContain('Could not read provider configuration.');
	});

	it.each(['resolve', 'reject'] as const)('ignores a late provider load after unmount: %s', async outcome => {
		const loading = deferred<[]>();
		vi.mocked(readConfiguredProviders).mockReturnValueOnce(loading.promise);
		const ui = setup();
		await command(ui, '/connect', 'Loading providers');
		ui.unmount();
		if (outcome === 'resolve') loading.resolve([]);
		else loading.reject(new Error('read failed'));
		await loading.promise.catch(() => {});
		await ui.flush();
		expect(ui.theme().notice).toBeUndefined();
		expect(saveProviderApiKey).not.toHaveBeenCalled();
	});
});

describe('theme selection flow', () => {
	it('puts the active theme first, saves another theme, and updates the current theme', async () => {
		const ui = setup();
		await command(ui, '/theme', 'Choose a theme');
		expect(ui.frame()).toContain('active');
		ui.stdin.write('\x1b[B');
		await ui.flush();
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('saved to user config.'));
		expect(saveThemePreference).toHaveBeenCalledOnce();
		expect(ui.theme().selectedId).toBe(requireValue(vi.mocked(saveThemePreference).mock.calls[0])[0]);
		expect(ui.theme().selectedId).not.toBe('konkan');
		expect(ui.keyboard().getOwner()).toBe('input-bar');
	});

	it('reports a save failure and retries the same selection', async () => {
		vi.mocked(saveThemePreference).mockRejectedValueOnce(new Error('disk full'));
		const ui = setup();
		await command(ui, '/theme', 'Choose a theme');
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Could not save theme: Error: disk full'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Using Konkan; saved to user config.'));
		expect(saveThemePreference).toHaveBeenCalledTimes(2);
	});

	it('prevents duplicate saves and Escape while saving', async () => {
		const saving = deferred<string>();
		vi.mocked(saveThemePreference).mockReturnValueOnce(saving.promise);
		const ui = setup();
		await command(ui, '/theme', 'Choose a theme');
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Saving theme'));
		ui.stdin.write('\r\x1b');
		await settleEscape(ui);
		expect(saveThemePreference).toHaveBeenCalledOnce();
		expect(ui.keyboard().getOwner()).toBe('theme-picker');
		saving.resolve('konkan');
		await vi.waitFor(() => expect(ui.frame()).toContain('Using Konkan; saved'));
	});

	it('cancels without changing the theme', async () => {
		const ui = setup();
		await command(ui, '/theme', 'Choose a theme');
		await escape(ui, 'Owner:input-bar');
		expect(saveThemePreference).not.toHaveBeenCalled();
		expect(ui.theme().selectedId).toBe('konkan');
	});

	it('rejects a theme that is absent from the registry', async () => {
		const ui = setup();
		await vi.waitFor(() => expect(ui.frame()).toContain('Owner:input-bar'));
		await expect(ui.theme().selectTheme('missing')).rejects.toThrow('Theme "missing" is not available.');
		expect(saveThemePreference).not.toHaveBeenCalled();
	});
});

describe('model selection flow', () => {
	it('uses the selected project for the displayed Git branch', async () => {
		const registry = createThemeRegistry([{source: 'builtin', themes: BUILTIN_THEMES.map(theme => ({source: 'builtin', theme}))}]);
		const ui = renderTerminal(<App registry={registry} initialThemeId="konkan"
			initialModelPreferences={{modelId: 'gpt-6.1-sol', effortByModel: {}}}
			serverBaseUrl="http://localhost" workspaceRoot="/chosen/project" initializeGraph={vi.fn<InitTransport>()} />);
		await vi.waitFor(() => expect(getGitBranch).toHaveBeenCalledWith('/chosen/project'));
		expect(ui.frame()).toContain('project-branch');
	});

	it('updates App preferences after saving and uses the selected model in the next request', async () => {
		const registry = createThemeRegistry([{source: 'builtin', themes: BUILTIN_THEMES.map(theme => ({source: 'builtin', theme}))}]);
		vi.mocked(saveModelPreference).mockResolvedValueOnce({modelId: 'claude-fable-5-1', effortByModel: {'claude-fable-5-1': 'high'}});
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(new Response('data: {"type":"done","durationMs":1}\n\n', {
			headers: {'content-type': 'text/event-stream'},
		}));
		vi.stubGlobal('fetch', fetchResponse);
		const ui = renderTerminal(<App registry={registry} initialThemeId="konkan"
			initialModelPreferences={{modelId: 'gemma-4-31b-it', effortByModel: {}}} serverBaseUrl="http://localhost" workspaceRoot={process.cwd()} initializeGraph={vi.fn<InitTransport>()} />);
		await vi.waitFor(() => expect(ui.frame()).toContain('Enter to send'));
		ui.stdin.write('/model');
		await vi.waitFor(() => expect(ui.frame()).toContain('Commands ·'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Choose a model'));
		ui.stdin.write('\x1b[B');
		await ui.flush();
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Choose effort for claude-fable-5-1'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Using claude-fable-5-1 · high; saved'));
		expect(saveModelPreference).toHaveBeenCalledExactlyOnceWith('claude-fable-5-1', 'high');
		ui.stdin.write('Next question');
		await vi.waitFor(() => expect(ui.frame()).toContain('Next question'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(fetchResponse).toHaveBeenCalledOnce());
		expect(parseJson(requestBody(requireValue(requireValue(fetchResponse.mock.calls[0])[1]).body))).toMatchObject({model: 'claude-fable-5-1', effort: 'high'});
	});
	it('saves a model with its default effort and closes both pickers', async () => {
		const ui = setup();
		await command(ui, '/model', 'Choose a model');
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Choose effort for gpt-6.1-sol'));
		expect(ui.frame()).toContain('medium · selected · default');
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Using gpt-6.1-sol · medium; saved'));
		expect(ui.onSelectModel).toHaveBeenCalledExactlyOnceWith('gpt-6.1-sol', 'medium');
		expect(ui.keyboard().getOwner()).toBe('input-bar');
	});

	it('saves a model that has no effort control immediately', async () => {
		const ui = setup('gemma-4-31b-it');
		await command(ui, '/model', 'Choose a model');
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Using gemma-4-31b-it; saved'));
		expect(ui.onSelectModel).toHaveBeenCalledExactlyOnceWith('gemma-4-31b-it', undefined);
	});

	it('returns from effort selection to model selection and cancels without saving', async () => {
		const ui = setup();
		await command(ui, '/model', 'Choose a model');
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Choose effort'));
		await escape(ui, 'Choose a model');
		await escape(ui, 'Owner:input-bar');
		expect(ui.onSelectModel).not.toHaveBeenCalled();
	});

	it('reports a failed model save and retries the same effort', async () => {
		const ui = setup();
		ui.onSelectModel.mockRejectedValueOnce(new Error('disk full'));
		await command(ui, '/model', 'Choose a model');
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Choose effort'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Could not save model: Error: disk full'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Using gpt-6.1-sol · medium; saved'));
		expect(ui.onSelectModel).toHaveBeenCalledTimes(2);
	});

	it('blocks duplicate selection and cancellation until a model save completes', async () => {
		const saving = deferred<void>();
		const ui = setup('gemma-4-31b-it');
		ui.onSelectModel.mockReturnValueOnce(saving.promise);
		await command(ui, '/model', 'Choose a model');
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Saving model'));
		ui.stdin.write('\r\x1b');
		await settleEscape(ui);
		expect(ui.onSelectModel).toHaveBeenCalledOnce();
		expect(ui.keyboard().getOwner()).toBe('model-picker');
		saving.resolve();
		await vi.waitFor(() => expect(ui.frame()).toContain('Using gemma-4-31b-it; saved'));
	});
});

describe('input commands', () => {
	it('toggles JEV through the palette and reports each saved state without submitting chat', async () => {
		vi.mocked(toggleJevUsage)
			.mockResolvedValueOnce({enabled: true, configured: true})
			.mockResolvedValueOnce({enabled: false, configured: true});
		const ui = setup();
		await command(ui, '/jev', 'JEV usage enabled; saved to user config.');
		expect(ui.keyboard().getOwner()).toBe('input-bar');
		await command(ui, '/jev', 'JEV usage disabled; saved to user config.');
		expect(toggleJevUsage).toHaveBeenCalledTimes(2);
		expect(ui.onSubmit).not.toHaveBeenCalled();
	});

	it('directs users to key setup when enabling without a configured key', async () => {
		vi.mocked(toggleJevUsage).mockRejectedValueOnce(new JevNotConfiguredError());
		const ui = setup();
		await command(ui, '/jev', 'Configure TypeSafe (JEV) through /connect before enabling JEV usage.');
		expect(ui.theme().noticeTone).toBe('error');
		expect(ui.onSubmit).not.toHaveBeenCalled();
	});

	it('reports a save failure without exposing raw configuration and allows retry', async () => {
		vi.mocked(toggleJevUsage).mockRejectedValueOnce(new Error('secret-from-invalid-config'));
		const ui = setup();
		await command(ui, '/jev', 'Could not update JEV usage.');
		expect(ui.frame()).not.toContain('secret-from-invalid-config');
		await command(ui, '/jev', 'JEV usage enabled; saved to user config.');
	});

	it('blocks duplicate commands and cancellation while saving the preference', async () => {
		const saving = deferred<{enabled: boolean; configured: boolean}>();
		vi.mocked(toggleJevUsage).mockReturnValueOnce(saving.promise);
		const ui = setup();
		await command(ui, '/jev', 'Saving JEV preference');
		ui.stdin.write('/jev\r\x1b');
		await settleEscape(ui);
		expect(toggleJevUsage).toHaveBeenCalledOnce();
		expect(ui.onSubmit).not.toHaveBeenCalled();
		saving.resolve({enabled: true, configured: true});
		await vi.waitFor(() => expect(ui.frame()).toContain('JEV usage enabled; saved to user config.'));
	});

	it.each(['resolve', 'reject'] as const)('does not post a late toggle notice after unmount: %s', async outcome => {
		const saving = deferred<{enabled: boolean; configured: boolean}>();
		vi.mocked(toggleJevUsage).mockReturnValueOnce(saving.promise);
		const ui = setup();
		await command(ui, '/jev', 'Saving JEV preference');
		ui.unmount();
		if (outcome === 'resolve') saving.resolve({enabled: true, configured: true});
		else saving.reject(new Error('write failed'));
		await saving.promise.catch(() => {});
		await ui.flush();
		expect(ui.theme().notice).toBeUndefined();
	});

	it('closes the palette when a space is added and executes the typed command case-insensitively', async () => {
		const ui = setup();
		await vi.waitFor(() => expect(ui.frame()).toContain('Enter to send'));
		ui.stdin.write('/HELP');
		await vi.waitFor(() => expect(ui.frame()).toContain('Commands ·'));
		ui.stdin.write(' ');
		await vi.waitFor(() => expect(ui.frame()).toContain('Owner:input-bar'));
		expect(ui.frame()).not.toContain('Commands ·');
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Available commands'));
		expect(ui.onSubmit).not.toHaveBeenCalled();
	});
	it('shows help, dismisses it with Escape, and rejects an unknown command', async () => {
		const ui = setup();
		await command(ui, '/help', 'Available commands');
		await escape(ui, 'Owner:input-bar');
		await vi.waitFor(() => expect(ui.frame()).not.toContain('Available commands'));
		ui.stdin.write('/unknown ');
		await vi.waitFor(() => expect(ui.frame()).toContain('/unknown '));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Unknown command: /unknown.'));
		expect(ui.onSubmit).not.toHaveBeenCalled();
	});

	it('executes a command after dismissing the palette and clears a draft on Escape', async () => {
		const ui = setup();
		await vi.waitFor(() => expect(ui.frame()).toContain('Enter to send'));
		ui.stdin.write('/help');
		await vi.waitFor(() => expect(ui.frame()).toContain('Commands ·'));
		await escape(ui, 'Owner:input-bar');
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Available commands'));
		ui.stdin.write('discard this');
		await vi.waitFor(() => expect(ui.frame()).toContain('discard this'));
		ui.stdin.write('\x1b');
		await vi.waitFor(() => expect(ui.frame()).not.toContain('discard this'));
	});

	it('ignores a whitespace-only draft and exits on the exit command', async () => {
		const ui = setup();
		await vi.waitFor(() => expect(ui.frame()).toContain('Enter to send'));
		ui.stdin.write('   ');
		await ui.flush();
		ui.stdin.write('\r');
		await ui.flush();
		expect(ui.onSubmit).not.toHaveBeenCalled();
		ui.stdin.write('\x1b');
		await settleEscape(ui);
		ui.stdin.write('/exit');
		await vi.waitFor(() => expect(ui.frame()).toContain('Commands ·'));
		ui.stdin.write('\r');
		await expect(ui.exited).resolves.toBeUndefined();
	});
});
