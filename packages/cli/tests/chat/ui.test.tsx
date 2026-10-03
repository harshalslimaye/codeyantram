import React, {type ReactNode} from 'react';
import {PassThrough} from 'node:stream';
import {render, type Instance} from 'ink';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {ChatRequest} from '@codeyantram/shared';
import {App} from '../../src/app.js';
import {InputBar} from '../../src/components/input-bar.js';
import {KeyboardProvider} from '../../src/keyboard/provider.js';
import {ThemeProvider} from '../../src/theme/provider.js';
import {createThemeRegistry} from '../../src/theme/registry/registry.js';
import {konkanTheme} from '../../src/theme/builtins/index.js';

const registry = createThemeRegistry([{source: 'builtin', themes: [{source: 'builtin', theme: konkanTheme}]}]);
const preferences = {modelId: 'gpt-6.1-sol', effortByModel: {}} as const;
const apps: Instance[] = [];

afterEach(async () => {
	for (const app of apps.splice(0)) {
		app.unmount();
		await app.waitUntilExit();
		app.cleanup();
	}
	vi.unstubAllGlobals();
});

function renderUI(node: ReactNode) {
	const stdout = Object.assign(new PassThrough(), {isTTY: true, columns: 80, rows: 24});
	const stdin = Object.assign(new PassThrough(), {isTTY: true, setRawMode: vi.fn(), ref: vi.fn(), unref: vi.fn()});
	let frame = '';
	stdout.on('data', chunk => {
		const text = String(chunk).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
		if (text.trim()) frame = text;
	});
	const app = render(node, {
		stdout: stdout as unknown as NodeJS.WriteStream,
		stdin: stdin as unknown as NodeJS.ReadStream,
		stderr: stdout as unknown as NodeJS.WriteStream,
		debug: true, interactive: true, patchConsole: false,
	});
	apps.push(app);
	return {stdin, stdout, frame: () => frame};
}

function renderInput(isStreaming = false) {
	const onSubmit = vi.fn();
	const onCancel = vi.fn();
	const onClear = vi.fn();
	const ui = renderUI(
		<ThemeProvider registry={registry} initialThemeId="konkan" colorDepth={0}>
			<KeyboardProvider>
				<InputBar modelPreferences={preferences} onSelectModel={async () => {}} isStreaming={isStreaming} onSubmit={onSubmit} onCancel={onCancel} onClear={onClear} />
			</KeyboardProvider>
		</ThemeProvider>,
	);
	return {...ui, onSubmit, onCancel, onClear};
}

describe('CLI chat UI', () => {
	it('submits the draft with Enter and clears the prompt', async () => {
		const ui = renderInput();
		await vi.waitFor(() => expect(ui.stdin.setRawMode).toHaveBeenCalled());
		ui.stdin.write('Hi there');
		await vi.waitFor(() => expect(ui.frame()).toContain('Hi there'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.onSubmit).toHaveBeenCalledExactlyOnceWith('Hi there'));
		await vi.waitFor(() => expect(ui.frame()).not.toContain('Hi there'));
	});

	it('selects /clear without also submitting the command as chat text', async () => {
		const ui = renderInput();
		await vi.waitFor(() => expect(ui.stdin.setRawMode).toHaveBeenCalled());
		ui.stdin.write('/clear');
		await vi.waitFor(() => expect(ui.frame()).toContain('Commands'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.onClear).toHaveBeenCalledOnce());
		expect(ui.onSubmit).not.toHaveBeenCalled();
	});

	it('disables typing during generation and cancels with Escape', async () => {
		const ui = renderInput(true);
		await vi.waitFor(() => expect(ui.frame()).toContain('Generating'));
		ui.stdin.write('ignored text\r');
		ui.stdin.write('\x1b');
		await vi.waitFor(() => expect(ui.onCancel).toHaveBeenCalledOnce());
		expect(ui.onSubmit).not.toHaveBeenCalled();
		expect(ui.frame()).not.toContain('ignored text');
	});

	it('displays streamed answers, sends follow-up history, and clears the conversation', async () => {
		const requests: ChatRequest[] = [];
		vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
			requests.push(JSON.parse(String(init?.body)) as ChatRequest);
			const text = [
				{type: 'start', messageId: `assistant-${requests.length}`},
				{type: 'text-delta', text: `Answer ${requests.length}`},
				{type: 'done', durationMs: 1},
			].map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
			return new Response(text, {headers: {'content-type': 'text/event-stream'}});
		}));
		const ui = renderUI(<App registry={registry} initialThemeId="konkan" initialModelPreferences={preferences} chatUrl="http://localhost/chat" />);
		await vi.waitFor(() => expect(ui.stdin.setRawMode).toHaveBeenCalled());
		ui.stdin.write('First question');
		await vi.waitFor(() => expect(ui.frame()).toContain('First question'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Answer 1'));
		ui.stdin.write('Follow up');
		await vi.waitFor(() => expect(ui.frame()).toContain('Follow up'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Answer 2'));
		expect(requests[1]?.messages.map(message => message.parts[0]?.text)).toEqual(['First question', 'Answer 1', 'Follow up']);
		ui.stdin.write('/clear');
		await vi.waitFor(() => expect(ui.frame()).toContain('Commands'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Type a message'));
		expect(requests).toHaveLength(2);
		expect(ui.frame()).not.toContain('Answer 2');
	});

	it('keeps long answers within the viewport and lets the user page through history', async () => {
		const text = Array.from({length: 60}, (_value, index) => `Line ${index + 1}`).join('\n');
		vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response([
			{type: 'start', messageId: 'assistant-1'}, {type: 'text-delta', text}, {type: 'done', durationMs: 1},
		].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {headers: {'content-type': 'text/event-stream'}})));
		const ui = renderUI(<App registry={registry} initialThemeId="konkan" initialModelPreferences={preferences} chatUrl="http://localhost/chat" />);
		await vi.waitFor(() => expect(ui.stdin.setRawMode).toHaveBeenCalled());
		ui.stdin.write('Long answer');
		await vi.waitFor(() => expect(ui.frame()).toContain('Long answer'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Line 60'));
		expect(ui.frame()).toContain('Enter to send');
		expect(ui.frame().trimEnd().split('\n').length).toBeLessThanOrEqual(24);
		ui.stdin.write('\x1b[5~');
		await vi.waitFor(() => expect(ui.frame()).not.toContain('Line 60'));
		ui.stdin.write('\x1b[6~');
		await vi.waitFor(() => expect(ui.frame()).toContain('Line 60'));
		ui.stdout.columns = 40;
		ui.stdout.rows = 16;
		ui.stdout.emit('resize');
		await vi.waitFor(() => expect(ui.frame().trimEnd().split('\n').length).toBeLessThanOrEqual(16));
	});
});
