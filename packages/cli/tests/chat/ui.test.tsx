import React, {useState, type ReactNode} from 'react';
import {PassThrough} from 'node:stream';
import {render, type Instance} from 'ink';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {ChatRequest, CompactRequest, CompactStreamEvent} from '@codeyantram/shared';
import {App} from '../../src/app.js';
import {InputBar} from '../../src/components/input-bar.js';
import {KeyboardProvider} from '../../src/keyboard/provider.js';
import {ThemeProvider} from '../../src/theme/provider.js';
import {createThemeRegistry} from '../../src/theme/registry/registry.js';
import {konkanTheme} from '../../src/theme/builtins/index.js';
import {ChatSession, type ChatTransport, type SessionOperation} from '../../src/chat/session.js';
import {ChatWorkspace} from '../../src/components/chat-workspace.js';

const registry = createThemeRegistry([{source: 'builtin', themes: [{source: 'builtin', theme: konkanTheme}]}]);
const preferences = {modelId: 'gpt-6.1-sol', effortByModel: {}} as const;
const apps: {app: Instance; exited: ReturnType<Instance['waitUntilExit']>}[] = [];

afterEach(async () => {
	for (const {app, exited} of apps.splice(0)) {
		app.unmount();
		await exited;
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
	// Ink registers a beforeExit listener when waiting; register it while mounted
	// so unmount removes it rather than installing a listener after cleanup.
	apps.push({app, exited: app.waitUntilExit()});
	return {stdin, stdout, frame: () => frame, unmount: () => app.unmount()};
}

function renderInput(initialOperation: SessionOperation = 'idle') {
	const onSubmit = vi.fn();
	const onCancel = vi.fn();
	const onClear = vi.fn();
	const onCompact = vi.fn();
	const onSelectModel = vi.fn(async () => {});
	let setOperation!: (operation: SessionOperation) => void;
	function InputHarness() {
		const [operation, changeOperation] = useState(initialOperation);
		setOperation = changeOperation;
		return (
			<ThemeProvider registry={registry} initialThemeId="konkan" colorDepth={0}>
				<KeyboardProvider>
					<InputBar modelPreferences={preferences} onSelectModel={onSelectModel} operation={operation} onSubmit={onSubmit} onCancel={onCancel} onClear={onClear} onCompact={onCompact} />
				</KeyboardProvider>
			</ThemeProvider>
		);
	}
	const ui = renderUI(<InputHarness />);
	return {...ui, onSubmit, onCancel, onClear, onCompact, onSelectModel, setOperation: (operation: SessionOperation) => setOperation(operation)};
}

const compactResult: CompactStreamEvent = {
	type: 'done', summary: 'HIDDEN_SUMMARY: preserve /src/chat.ts; checks pending.', durationMs: 1,
	usage: {inputTokens: 100, outputTokens: 20},
};

function eventResponse(events: unknown[]) {
	return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
		headers: {'content-type': 'text/event-stream'},
	});
}

/** Real App/session/transport wiring with deterministic HTTP responses. */
async function renderCompactionApp() {
	const chatRequests: ChatRequest[] = [];
	const compactRequests: CompactRequest[] = [];
	const cancel = vi.fn();
	let pending!: ReadableStreamDefaultController<Uint8Array>;
	let compactSignal: AbortSignal | undefined;
	vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
		if (new URL(String(url)).pathname === '/compact') {
			compactRequests.push(JSON.parse(String(init?.body)) as CompactRequest);
			compactSignal = init?.signal ?? undefined;
			return new Response(new ReadableStream<Uint8Array>({
				start(controller) {
					pending = controller;
					controller.enqueue(new TextEncoder().encode('data: {"type":"start"}\n\n'));
				}, cancel,
			}), {headers: {'content-type': 'text/event-stream'}});
		}
		chatRequests.push(JSON.parse(String(init?.body)) as ChatRequest);
		const turn = chatRequests.length;
		const text = (turn === 1 ? 'ARCHIVED_HISTORY: exact constraints and pending validation.\n'.repeat(150) : '') + `Answer ${turn}`;
		return eventResponse([
			{type: 'start', messageId: `assistant-${turn}`}, {type: 'text-delta', text}, {type: 'done', durationMs: 1},
		]);
	}));
	const ui = renderUI(<App registry={registry} initialThemeId="konkan" initialModelPreferences={preferences} serverBaseUrl="http://localhost" />);
	await vi.waitFor(() => expect(ui.stdin.setRawMode).toHaveBeenCalled());
	for (let turn = 1; turn <= 3; turn++) {
		ui.stdin.write(`Question ${turn}`);
		await vi.waitFor(() => expect(ui.frame()).toContain(`Question ${turn}`));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain(`Answer ${turn}`));
	}
	return {
		...ui, chatRequests, compactRequests, cancel,
		compactSignal: () => compactSignal,
		complete(event: CompactStreamEvent = compactResult) {
			pending.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
			pending.close();
		},
	};
}

async function selectCompact(ui: {stdin: PassThrough; frame: () => string}) {
	ui.stdin.write('/compact');
	await vi.waitFor(() => expect(ui.frame()).toContain('Summarize older conversation context'));
	ui.stdin.write('\r');
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

	it.each([false, true])('executes /compact exactly once without submitting chat text (palette dismissed=%s)', async dismissPalette => {
		const ui = renderInput();
		await vi.waitFor(() => expect(ui.stdin.setRawMode).toHaveBeenCalled());
		ui.stdin.write('/compact');
		await vi.waitFor(() => expect(ui.frame()).toContain('Summarize older conversation context'));
		if (dismissPalette) {
			ui.stdin.write('\x1b');
			await vi.waitFor(() => expect(ui.frame()).not.toContain('Commands ·'));
		}
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.onCompact).toHaveBeenCalledOnce());
		expect(ui.onSubmit).not.toHaveBeenCalled();
		expect(ui.onClear).not.toHaveBeenCalled();
	});

	it('disables text and picker commands during compaction and cancels with Escape', async () => {
		const ui = renderInput('compact');
		await vi.waitFor(() => expect(ui.frame()).toContain('Compacting conversation · Esc to cancel'));
		ui.stdin.write('ignored text\r/model\r/connect\r/theme\r/compact\r');
		ui.stdin.write('\x1b');
		await vi.waitFor(() => expect(ui.onCancel).toHaveBeenCalledOnce());
		expect(ui.onSubmit).not.toHaveBeenCalled();
		expect(ui.onCompact).not.toHaveBeenCalled();
		expect(ui.onSelectModel).not.toHaveBeenCalled();
		expect(ui.frame()).not.toContain('ignored text');
		expect(ui.frame()).not.toContain('Commands ·');
		expect(ui.frame()).not.toContain('Choose a model');
	});

	it('closes a nested picker when an operation starts and restores prompt input afterward', async () => {
		const ui = renderInput();
		await vi.waitFor(() => expect(ui.stdin.setRawMode).toHaveBeenCalled());
		ui.stdin.write('/model');
		await vi.waitFor(() => expect(ui.frame()).toContain('Commands ·'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Choose a model'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Choose effort'));
		ui.setOperation('compact');
		await vi.waitFor(() => expect(ui.frame()).toContain('Compacting conversation'));
		expect(ui.frame()).not.toContain('Choose effort');
		ui.stdin.write('\r\x1b');
		await vi.waitFor(() => expect(ui.onCancel).toHaveBeenCalledOnce());
		expect(ui.onSelectModel).not.toHaveBeenCalled();
		ui.setOperation('idle');
		await vi.waitFor(() => expect(ui.frame()).toContain('Enter to send'));
		ui.stdin.write('Next question');
		await vi.waitFor(() => expect(ui.frame()).toContain('Next question'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.onSubmit).toHaveBeenCalledExactlyOnceWith('Next question'));
	});

	it('compacts from the command, shows progress and context status, keeps history scrollable, and follows up with the summary', async () => {
		const ui = await renderCompactionApp();
		const original = ui.chatRequests[2]!.messages;
		await selectCompact(ui);
		await vi.waitFor(() => expect(ui.frame()).toContain('Compacting conversation · Esc to cancel'));
		expect(ui.chatRequests).toHaveLength(3);
		expect(ui.compactRequests).toHaveLength(1);
		expect(ui.compactRequests[0]).toMatchObject({model: preferences.modelId});
		expect(ui.compactRequests[0]!.messages.map(message => message.parts[0]?.text)).toEqual(original.slice(0, 2).map(message => message.parts[0]?.text));
		expect(ui.frame()).not.toContain('Waiting for response');
		ui.complete();
		await vi.waitFor(() => expect(ui.frame()).toContain('Compacted 2 messages'));
		expect(ui.frame()).toContain('Context: compacted · 2 recent turns');
		expect(ui.frame()).not.toContain('HIDDEN_SUMMARY');
		expect(ui.frame().trimEnd().split('\n').length).toBeLessThanOrEqual(24);
		ui.stdout.columns = 40;
		ui.stdout.rows = 16;
		ui.stdout.emit('resize');
		await vi.waitFor(() => expect(ui.frame().trimEnd().split('\n').length).toBeLessThanOrEqual(16));
		ui.stdout.columns = 80;
		ui.stdout.rows = 24;
		ui.stdout.emit('resize');
		await vi.waitFor(() => expect(ui.frame()).toContain('Context: compacted · 2 recent turns'));
		ui.stdin.write('\x1b[5~');
		await vi.waitFor(() => expect(ui.frame()).toContain('ARCHIVED_HISTORY'));
		ui.stdin.write('Follow up');
		await vi.waitFor(() => expect(ui.frame()).toContain('Follow up'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Answer 4'));
		expect(ui.chatRequests[3]).toMatchObject({contextSummary: compactResult.summary});
		expect(ui.chatRequests[3]!.messages.map(message => message.parts[0]?.text)).toEqual(['Question 2', 'Answer 2', 'Question 3', 'Answer 3', 'Follow up']);
		expect(ui.frame()).toContain('Context: compacted · 3 recent turns');
		ui.stdin.write('/clear');
		await vi.waitFor(() => expect(ui.frame()).toContain('Commands ·'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Type a message'));
		expect(ui.frame()).not.toContain('Context: compacted');
	});

	it('cancels command compaction with Escape, preserves full context, and accepts another turn', async () => {
		const ui = await renderCompactionApp();
		await selectCompact(ui);
		await vi.waitFor(() => expect(ui.frame()).toContain('Compacting conversation'));
		ui.stdin.write('\x1b');
		await vi.waitFor(() => expect(ui.frame()).toContain('Compaction cancelled. Previous context has been kept.'));
		expect(ui.compactSignal()?.aborted).toBe(true);
		await vi.waitFor(() => expect(ui.cancel).toHaveBeenCalledOnce());
		expect(ui.frame()).not.toContain('Context: compacted');
		ui.stdin.write('Continue');
		await vi.waitFor(() => expect(ui.frame()).toContain('Continue'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Answer 4'));
		expect(ui.chatRequests[3]).not.toHaveProperty('contextSummary');
		expect(ui.chatRequests[3]!.messages).toHaveLength(7);
		expect(ui.chatRequests[3]!.messages[1]?.parts[0]?.text).toContain('ARCHIVED_HISTORY');
	});

	it('aborts an active command compaction when the App unmounts', async () => {
		const ui = await renderCompactionApp();
		await selectCompact(ui);
		await vi.waitFor(() => expect(ui.frame()).toContain('Compacting conversation'));
		ui.unmount();
		await vi.waitFor(() => expect(ui.compactSignal()?.aborted).toBe(true));
		await vi.waitFor(() => expect(ui.cancel).toHaveBeenCalledOnce());
	});

	it('shows a no-op notice for short history and makes no HTTP request', async () => {
		const fetchResponse = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchResponse);
		const ui = renderUI(<App registry={registry} initialThemeId="konkan" initialModelPreferences={preferences} serverBaseUrl="http://localhost" />);
		await vi.waitFor(() => expect(ui.stdin.setRawMode).toHaveBeenCalled());
		await selectCompact(ui);
		await vi.waitFor(() => expect(ui.frame()).toContain('No older conversation turns are available to compact'));
		expect(fetchResponse).not.toHaveBeenCalled();
		expect(ui.frame()).not.toContain('Context: compacted');
	});

	it.each([
		{event: {type: 'error', code: 'compaction_failed', message: 'The summary was incomplete.'} as CompactStreamEvent, notice: 'The summary was incomplete.'},
		{event: {...compactResult, summary: 'ARCHIVED_HISTORY: exact constraints and pending validation.\n'.repeat(150)}, notice: 'did not reduce older context'},
	])('shows an unsuccessful compaction notice: $notice', async ({event, notice}) => {
		const ui = await renderCompactionApp();
		await selectCompact(ui);
		await vi.waitFor(() => expect(ui.frame()).toContain('Compacting conversation'));
		ui.complete(event);
		await vi.waitFor(() => expect(ui.frame()).toContain(notice));
		expect(ui.frame()).toContain('Enter to send');
		expect(ui.frame()).not.toContain('Context: compacted');
	});

	it('omits an old empty assistant placeholder while compacting', async () => {
		let finish!: () => void;
		const chat = vi.fn<ChatTransport>().mockImplementationOnce(async function* () {
			yield {type: 'error', code: 'provider_error', message: 'Failed earlier turn.'};
		}).mockImplementation(async function* () {yield {type: 'done', durationMs: 1};});
		const session = new ChatSession(chat, async function* () {
			await new Promise<void>(resolve => {finish = resolve;});
			yield compactResult;
		});
		for (const text of ['Prior objective.\n'.repeat(500), 'Recent', 'Latest']) await session.send(text, preferences.modelId);
		const ui = renderUI(
			<ThemeProvider registry={registry} initialThemeId="konkan" colorDepth={0}>
				<KeyboardProvider>
					<ChatWorkspace session={session} modelPreferences={preferences} branch="main" onSelectModel={async () => {}} />
				</KeyboardProvider>
			</ThemeProvider>,
		);
		await vi.waitFor(() => expect(ui.stdin.setRawMode).toHaveBeenCalled());
		await selectCompact(ui);
		await vi.waitFor(() => expect(ui.frame()).toContain('Compacting conversation'));
		expect(ui.frame()).not.toContain('Waiting for response');
		finish();
		await vi.waitFor(() => expect(ui.frame()).toContain('Context: compacted'));
	});

	it('disables typing during generation and cancels with Escape', async () => {
		const ui = renderInput('chat');
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
		const ui = renderUI(<App registry={registry} initialThemeId="konkan" initialModelPreferences={preferences} serverBaseUrl="http://localhost" />);
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
		const ui = renderUI(<App registry={registry} initialThemeId="konkan" initialModelPreferences={preferences} serverBaseUrl="http://localhost" />);
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
