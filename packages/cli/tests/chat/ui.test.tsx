import {requireTextPart} from '../helpers/message-parts.js';
import React, {useState, type ReactNode} from 'react';
import {PassThrough} from 'node:stream';
import {render, type Instance} from 'ink';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {ChatRequest, ChatStreamEvent, CompactRequest, CompactStreamEvent} from '@codeyantram/shared';
import {App} from '../../src/app.js';
import {InputBar} from '../../src/components/input-bar.js';
import {KeyboardProvider} from '../../src/keyboard/provider.js';
import {ThemeProvider} from '../../src/theme/provider.js';
import {createThemeRegistry} from '../../src/theme/registry/registry.js';
import {konkanTheme} from '../../src/theme/builtins/index.js';
import {ChatSession, type ChatTransport, type InitTransport, type SessionOperation} from '../../src/chat/session.js';
import {ChatWorkspace} from '../../src/components/chat-workspace.js';
import {createTerminalInput} from '../../src/terminal/input.js';
import {MouseProvider} from '../../src/terminal/mouse.js';
const initializeGraph = vi.fn<InitTransport>();

const registry = createThemeRegistry([{source: 'builtin', themes: [{source: 'builtin', theme: konkanTheme}]}]);
const preferences = {modelId: 'gpt-6.1-sol', effortByModel: {}} as const;
const apps: {app: Instance; exited: ReturnType<Instance['waitUntilExit']>; input: ReturnType<typeof createTerminalInput>}[] = [];

afterEach(async () => {
	for (const {app, exited, input} of apps.splice(0)) {
		app.unmount();
		await exited;
		app.cleanup();
		input.dispose();
	}
	vi.unstubAllGlobals();
});

function renderUI(node: ReactNode, {debug = true}: {debug?: boolean} = {}) {
	const stdout = Object.assign(new PassThrough(), {isTTY: true, columns: 80, rows: 24});
	const stdin = Object.assign(new PassThrough(), {isTTY: true, setRawMode: vi.fn(), ref: vi.fn(), unref: vi.fn()});
	const input = createTerminalInput(stdin as unknown as NodeJS.ReadStream, stdout as unknown as NodeJS.WriteStream);
	let frame = '';
	let output = '';
	stdout.on('data', chunk => {
		output += String(chunk);
		const text = String(chunk).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
		if (text.trim()) frame = text;
	});
	const app = render(<MouseProvider value={input}>{node}</MouseProvider>, {
		stdout: stdout as unknown as NodeJS.WriteStream,
		stdin: input.stdin,
		stderr: stdout as unknown as NodeJS.WriteStream,
		debug, interactive: true, alternateScreen: true, patchConsole: false,
	});
	// Ink registers a beforeExit listener when waiting; register it while mounted
	// so unmount removes it rather than installing a listener after cleanup.
	apps.push({app, exited: app.waitUntilExit(), input});
	return {
		stdin, stdout, frame: () => frame, output: () => output, flush: () => app.waitUntilRenderFlush(), unmount: () => app.unmount(),
		wheel: (direction: 'up' | 'down', y = 1) => stdin.write(`\x1b[<${direction === 'up' ? 64 : 65};2;${y}M`),
	};
}

function renderInput(initialOperation: SessionOperation = 'idle') {
	const onSubmit = vi.fn();
	const onCancel = vi.fn();
	const onClear = vi.fn();
	const onCompact = vi.fn();
	const onStatus = vi.fn();
	const onInit = vi.fn();
	const onSelectModel = vi.fn(async () => {});
	let setOperation!: (operation: SessionOperation) => void;
	function InputHarness() {
		const [operation, changeOperation] = useState(initialOperation);
		setOperation = changeOperation;
		return (
			<ThemeProvider registry={registry} initialThemeId="konkan" colorDepth={0}>
				<KeyboardProvider>
					<InputBar modelPreferences={preferences} onSelectModel={onSelectModel} operation={operation} onSubmit={onSubmit} onCancel={onCancel} onClear={onClear} onCompact={onCompact} onStatus={onStatus} onInit={onInit} />
				</KeyboardProvider>
			</ThemeProvider>
		);
	}
	const ui = renderUI(<InputHarness />);
	return {...ui, onSubmit, onCancel, onClear, onCompact, onStatus, onInit, onSelectModel, setOperation: (operation: SessionOperation) => setOperation(operation)};
}

function renderWorkspace(session: ChatSession, {debug = true}: {debug?: boolean} = {}) {
	return renderUI(
		<ThemeProvider registry={registry} initialThemeId="konkan" colorDepth={0}>
			<KeyboardProvider>
				<ChatWorkspace session={session} modelPreferences={preferences} branch="main" onSelectModel={async () => {}} />
			</KeyboardProvider>
		</ThemeProvider>,
		{debug},
	);
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
	const ui = renderUI(<App registry={registry} initialThemeId="konkan" initialModelPreferences={preferences} serverBaseUrl="http://localhost" workspaceRoot={process.cwd()} initializeGraph={initializeGraph} />);
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
  it('shows a fetched URL, truncation, and JEV fallback notices without dumping the page', async () => {
    const session = new ChatSession(async function* (): AsyncGenerator<ChatStreamEvent> {
      yield {type: 'start', messageId: 'web-ui'};
      yield {type: 'tool-call', call: {toolCallId: 'web-call', toolName: 'web_fetch', input: {url: 'https://example.com/docs', query: 'authentication'}}};
      yield {type: 'tool-result', result: {toolCallId: 'web-call', toolName: 'web_fetch', status: 'success', output: {
        content: 'PRIVATE_PAGE_BODY', truncation: {truncated: true}, filtering: {status: 'skipped'},
        warnings: ['JEV filtering skipped: configure TypeSafe through /connect. Normal content returned.'],
      }}};
      yield {type: 'done', durationMs: 1};
    });
    const ui = renderWorkspace(session);
    await session.send('Read this URL', 'gpt-6.1-sol');
    await vi.waitFor(() => expect(ui.frame()).toContain('https://example.com/docs'));
    expect(ui.frame()).toContain('web_fetch · completed');
    expect(ui.frame()).toContain('output truncated');
    expect(ui.frame()).toContain('JEV filtering skipped');
    expect(ui.frame()).not.toContain('PRIVATE_PAGE_BODY');
  });

  it('shows navigation activity and completion without dumping source results', async () => {
		let finish!: () => void;
		const pending = new Promise<void>(resolve => {finish = resolve;});
		const session = new ChatSession(async function* (): AsyncGenerator<ChatStreamEvent> {
			yield {type: 'start', messageId: 'tool-ui-1'};
			yield {type: 'tool-call', call: {toolCallId: 'c1', toolName: 'explore', input: {query: 'greet'}}};
			yield {type: 'tool-result', result: {toolCallId: 'c1', toolName: 'explore', status: 'success', output: {source: 'LARGE_HISTORICAL_SOURCE'}}};
			yield {type: 'tool-call', call: {toolCallId: 'c2', toolName: 'inspect', input: {reference: {workspaceId: 'a'.repeat(64), symbolId: 'hidden-symbol-id', filePath: 'entry.ts', contentHash: 'b'.repeat(64)}}}};
			await pending;
			yield {type: 'tool-result', result: {toolCallId: 'c2', toolName: 'inspect', status: 'success', output: {source: 'LARGE_HISTORICAL_SOURCE'}}};
			yield {type: 'text-delta', text: 'Found greet in entry.ts.'};
			yield {type: 'done', durationMs: 1};
		});
		const ui = renderWorkspace(session);
		const sending = session.send('Locate greet', 'gpt-6.1-sol');
		try {
			await vi.waitFor(() => expect(ui.frame()).toContain('Tool inspect · entry.ts'));
			expect(ui.frame()).toContain('greet');
			expect(ui.frame()).not.toContain('workspaceId');
			expect(ui.frame()).not.toContain('hidden-symbol-id');
			expect(ui.frame()).not.toContain('b'.repeat(64));
			expect(session.getSnapshot().isStreaming).toBe(true);
		} finally {finish();}
		await sending;
		await vi.waitFor(() => expect(ui.frame()).toContain('inspect · completed'));
		expect(ui.frame()).toContain('Found greet in entry.ts.');
		expect(ui.frame()).not.toContain('LARGE_HISTORICAL_SOURCE');
	});

	it.each([false, true])('executes /init exactly once without sending chat text (palette dismissed=%s)', async dismissPalette => {
		const ui = renderInput();
		ui.stdin.write('/init');
		await vi.waitFor(() => expect(ui.frame()).toContain('Build or refresh the project code graph'));
		if (dismissPalette) {
			ui.stdin.write('\x1b');
			await vi.waitFor(() => expect(ui.frame()).not.toContain('Commands ·'));
		}
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.onInit).toHaveBeenCalledOnce());
		expect(ui.onSubmit).not.toHaveBeenCalled();
	});

	it('uses the server-bound initializer, shows progress and completion, and keeps chat available afterward', async () => {
		let complete!: (message: string) => void;
		vi.mocked(initializeGraph).mockImplementation(async (_signal, progress) => {
			progress('Indexing graph · parsing: 1/2');
			return new Promise<string>(resolve => {complete = resolve;});
		});
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(eventResponse([
			{type: 'start', messageId: 'after-init'}, {type: 'text-delta', text: 'POST_INIT_REPLY'}, {type: 'done', durationMs: 1},
		]));
		vi.stubGlobal('fetch', fetch);
		const root = '/selected/codebase';
		const ui = renderUI(<App registry={registry} initialThemeId="konkan" initialModelPreferences={preferences} serverBaseUrl="http://localhost" workspaceRoot={root} initializeGraph={initializeGraph} />);
		ui.stdin.write('/init');
		await vi.waitFor(() => expect(ui.frame()).toContain('Build or refresh the project code graph'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Initializing graph · Esc to cancel'));
		expect(ui.frame()).toContain('parsing: 1/2');
		expect(initializeGraph).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal), expect.any(Function));
		expect(fetch).not.toHaveBeenCalled();
		ui.stdin.write('ignored input\r/init\r/model\r');
		await ui.flush();
		expect(ui.frame()).not.toContain('ignored input');
		complete('Graph ready: 2 files, 4 symbols, 3 relationships.');
		await vi.waitFor(() => expect(ui.frame()).toContain('Graph ready: 2 files'));
		expect(ui.frame()).not.toContain('Initializing graph ·');
		expect(ui.frame()).not.toContain('ignored input');
		ui.stdin.write('Follow up');
		await vi.waitFor(() => expect(ui.frame()).toContain('Follow up'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('POST_INIT_REPLY'));
		expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).messages).toHaveLength(1);
	});

	it.each(['escape', 'unmount'] as const)('cancels palette initialization on %s and waits for cleanup', async action => {
		let signal!: AbortSignal;
		let drain!: (message: string) => void;
		vi.mocked(initializeGraph).mockImplementation(async (activeSignal) => {
			signal = activeSignal;
			return new Promise<string>(resolve => {drain = resolve;});
		});
		const ui = renderUI(<App registry={registry} initialThemeId="konkan" initialModelPreferences={preferences} serverBaseUrl="http://localhost" workspaceRoot={process.cwd()} initializeGraph={initializeGraph} />);
		ui.stdin.write('/init');
		await vi.waitFor(() => expect(ui.frame()).toContain('Build or refresh the project code graph'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Initializing graph · Esc to cancel'));
		if (action === 'escape') ui.stdin.write('\x1b');
		else ui.unmount();
		await vi.waitFor(() => expect(signal.aborted).toBe(true));
		if (action === 'escape') {
			expect(ui.frame()).toContain('Cancelling graph initialization');
			ui.stdin.write('/init\r');
			expect(initializeGraph).toHaveBeenCalledOnce();
		}
		drain('Graph ready: should be ignored after cancellation.');
		if (action === 'escape') {
			await vi.waitFor(() => expect(ui.frame()).toContain('Graph initialization cancelled'));
			expect(ui.frame()).not.toContain('should be ignored');
		}
	});

	it('shows a graph initialization failure and returns to editing', async () => {
		vi.mocked(initializeGraph).mockRejectedValue(new Error('Index is locked. Retry /init later.'));
		const ui = renderUI(<App registry={registry} initialThemeId="konkan" initialModelPreferences={preferences} serverBaseUrl="http://localhost" workspaceRoot={process.cwd()} initializeGraph={initializeGraph} />);
		ui.stdin.write('/init');
		await vi.waitFor(() => expect(ui.frame()).toContain('Build or refresh the project code graph'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Index is locked. Retry /init later.'));
		ui.stdin.write('Try another message');
		await vi.waitFor(() => expect(ui.frame()).toContain('Try another message'));
	});
	it('does not keep the waiting placeholder after a completed empty-text answer', async () => {
		const session = new ChatSession(async function* () {
			yield {type: 'text-delta', text: ''};
			yield {type: 'done', durationMs: 1};
		});
		await session.send('An empty answer is allowed.', preferences.modelId);
		const ui = renderWorkspace(session);
		await vi.waitFor(() => expect(ui.frame()).toContain('An empty answer is allowed.'));
		expect(ui.frame()).toContain('Assistant');
		expect(ui.frame()).not.toContain('Waiting for response');
		expect(ui.frame()).not.toContain('Generating');
	});
	it('appends /status snapshots to scrollback without calling the model, updates the footer, and handles resize and clear', async () => {
		const chat = vi.fn<ChatTransport>().mockImplementation(async function* () {
			yield {type: 'text-delta', text: 'STATUS_REPLY '.repeat(1_000)};
			yield {type: 'done', durationMs: 1};
		});
		const session = new ChatSession(chat);
		const ui = renderWorkspace(session);
		await vi.waitFor(() => expect(ui.frame()).toContain('Context ~0% used'));
		ui.stdin.write('/status');
		await vi.waitFor(() => expect(ui.frame()).toContain('Show model and estimated context usage'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Session status'));
		expect(session.getSnapshot().statusEntries).toHaveLength(1);
		expect(ui.frame()).toContain('~0 / 1,050,000 tokens');
		expect(ui.frame()).toContain('~100% remaining');
		expect(chat).not.toHaveBeenCalled();
		const first = structuredClone(session.getSnapshot().statusEntries[0]!);
		await session.send('First question.', preferences.modelId);
		await vi.waitFor(() => expect(ui.frame()).toContain('Context ~0.3% used'));
		expect(ui.frame()).not.toContain('Session status');
		for (let step = 0; step < 100; step++) ui.wheel('up');
		await vi.waitFor(() => expect(ui.frame()).toContain('Session status'));
		expect(ui.frame()).toContain('~0 / 1,050,000 tokens');
		expect(session.getSnapshot().statusEntries[0]).toEqual(first);
		ui.stdin.write('/status');
		await vi.waitFor(() => expect(ui.frame()).toContain('Show model and estimated context usage'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(session.getSnapshot().statusEntries).toHaveLength(2));
		await vi.waitFor(() => expect(ui.frame()).toContain('~99.7% remaining'));
		expect(chat).toHaveBeenCalledOnce();
		ui.stdout.columns = 40;
		ui.stdout.rows = 16;
		ui.stdout.emit('resize');
		await vi.waitFor(() => expect(ui.frame().trimEnd().split('\n')).toHaveLength(16));
		expect(ui.frame()).toContain('Session status');
		expect(ui.frame()).toContain('Ctx ~0.3%');
		expect(ui.frame().trimEnd().split('\n').at(-1)).toContain('git:main');
		session.clear();
		await vi.waitFor(() => expect(ui.frame()).not.toContain('Session status'));
		expect(ui.frame()).toContain('Ctx ~0%');
	});

	it('keeps the welcome banner in scrollback after chat starts and on short terminals', async () => {
		const chat = vi.fn<ChatTransport>().mockImplementation(async function* () {
			yield {type: 'text-delta', text: Array.from({length: 40}, (_, index) => `WELCOME_REPLY_${index + 1}`).join('\n')};
			yield {type: 'done', durationMs: 1};
		});
		const session = new ChatSession(chat);
		const ui = renderWorkspace(session);
		await vi.waitFor(() => expect(ui.frame()).toContain('Welcome to CodeYantram.'));
		expect(ui.frame()).toContain('█▀▀ █▀█ █▀▄ █▀▀');
		await session.send('First question.', preferences.modelId);
		await vi.waitFor(() => expect(ui.frame()).toContain('WELCOME_REPLY_40'));
		expect(ui.frame()).not.toContain('Welcome to CodeYantram.');
		for (let step = 0; step < 25; step++) ui.wheel('up');
		await vi.waitFor(() => expect(ui.frame()).toContain('Welcome to CodeYantram.'));
		expect(ui.frame()).toContain('█▀▀ █▀█ █▀▄ █▀▀');
		expect(chat.mock.calls[0]![0].messages.map(message => message.parts.map(requireTextPart)[0]?.text)).toEqual(['First question.']);
		ui.stdout.rows = 12;
		ui.stdout.emit('resize');
		await vi.waitFor(() => expect(ui.frame().trimEnd().split('\n')).toHaveLength(12));
		for (let step = 0; step < 25; step++) ui.wheel('up');
		await vi.waitFor(() => expect(ui.frame()).toContain('█▀▀ █▀█ █▀▄ █▀▀'));
		expect(ui.frame().trimEnd().split('\n')).toHaveLength(12);
		expect(ui.frame().trimEnd().split('\n').at(-1)).toContain('git:main');
		ui.stdout.rows = 24;
		ui.stdout.emit('resize');
		await vi.waitFor(() => expect(ui.frame().trimEnd().split('\n')).toHaveLength(24));
		session.clear();
		await vi.waitFor(() => expect(session.getSnapshot().messages).toHaveLength(0));
		await ui.flush();
		await vi.waitFor(() => expect(ui.frame()).toContain('Welcome to CodeYantram.'));
		expect(ui.frame()).not.toContain('WELCOME_REPLY_');
	});

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

	it('compacts from the command, keeps mouse history available above the pinned footer, and follows up with the summary', async () => {
		const ui = await renderCompactionApp();
		const original = ui.chatRequests[2]!.messages;
		await selectCompact(ui);
		await vi.waitFor(() => expect(ui.frame()).toContain('Compacting conversation · Esc to cancel'));
		expect(ui.chatRequests).toHaveLength(3);
		expect(ui.compactRequests).toHaveLength(1);
		expect(ui.compactRequests[0]).toMatchObject({model: preferences.modelId});
		expect(ui.compactRequests[0]!.messages.map(message => message.parts.map(requireTextPart)[0]?.text)).toEqual(original.slice(0, 2).map(message => message.parts.map(requireTextPart)[0]?.text));
		expect(ui.frame()).not.toContain('Waiting for response');
		ui.complete();
		await vi.waitFor(() => expect(ui.frame()).toContain('Compacted 2 messages'));
		expect(ui.frame()).toContain('Context: compacted · 2 recent turns');
		expect(ui.frame()).not.toContain('HIDDEN_SUMMARY');
		expect(ui.frame().trimEnd().split('\n')).toHaveLength(24);
		for (let step = 0; step < 6; step++) ui.wheel('up');
		await vi.waitFor(() => expect(ui.frame()).toContain('ARCHIVED_HISTORY'));
		expect(ui.frame()).toContain('Context: compacted · 2 recent turns');
		ui.stdout.columns = 40;
		ui.stdout.rows = 16;
		ui.stdout.emit('resize');
		await vi.waitFor(() => expect(ui.frame().trimEnd().split('\n')).toHaveLength(16));
		expect(ui.frame()).toContain('Mouse/trackpad scroll');
		ui.stdout.columns = 80;
		ui.stdout.rows = 24;
		ui.stdout.emit('resize');
		await vi.waitFor(() => expect(ui.frame().trimEnd().split('\n')).toHaveLength(24));
		await vi.waitFor(() => expect(ui.frame()).toContain('Context: compacted · 2 recent turns'));
		ui.stdin.write('Follow up');
		await vi.waitFor(() => expect(ui.frame()).toContain('Follow up'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Answer 4'));
		expect(ui.chatRequests[3]).toMatchObject({contextSummary: compactResult.summary});
		expect(ui.chatRequests[3]!.messages.map(message => message.parts.map(requireTextPart)[0]?.text)).toEqual(['Question 2', 'Answer 2', 'Question 3', 'Answer 3', 'Follow up']);
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
		expect(ui.chatRequests[3]!.messages[1]?.parts.map(requireTextPart)[0]?.text).toContain('ARCHIVED_HISTORY');
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
		const ui = renderUI(<App registry={registry} initialThemeId="konkan" initialModelPreferences={preferences} serverBaseUrl="http://localhost" workspaceRoot={process.cwd()} initializeGraph={initializeGraph} />);
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
		const ui = renderUI(<App registry={registry} initialThemeId="konkan" initialModelPreferences={preferences} serverBaseUrl="http://localhost" workspaceRoot={process.cwd()} initializeGraph={initializeGraph} />);
		await vi.waitFor(() => expect(ui.stdin.setRawMode).toHaveBeenCalled());
		ui.stdin.write('First question');
		await vi.waitFor(() => expect(ui.frame()).toContain('First question'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Answer 1'));
		ui.stdin.write('Follow up');
		await vi.waitFor(() => expect(ui.frame()).toContain('Follow up'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Answer 2'));
		expect(requests[1]?.messages.map(message => message.parts.map(requireTextPart)[0]?.text)).toEqual(['First question', 'Answer 1', 'Follow up']);
		ui.stdin.write('/clear');
		await vi.waitFor(() => expect(ui.frame()).toContain('Commands'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Type a message'));
		expect(requests).toHaveLength(2);
		await vi.waitFor(() => expect(ui.frame()).not.toContain('Answer 2'));
	});

	it('renders assistant Markdown, leaves user text literal, and sends original Markdown in follow-up context', async () => {
		const markdown = '# Result\n\n**Assistant bold** and `inline code`.\n\n- **First item**\n\n[Docs](https://example.com)';
		const chat = vi.fn<ChatTransport>().mockImplementation(async function* () {
			yield {type: 'text-delta', text: markdown};
			yield {type: 'done', durationMs: 1};
		});
		const session = new ChatSession(chat);
		const ui = renderWorkspace(session);
		await session.send('Keep **user markup** and `user code`.', preferences.modelId);
		await vi.waitFor(() => expect(ui.frame()).toContain('Assistant bold and inline code.'));
		expect(ui.frame()).toContain('Keep **user markup** and `user code`.');
		expect(ui.frame()).toContain('* First item');
		expect(ui.frame()).toContain('Docs (https://example.com)');
		expect(ui.frame()).not.toContain('# Result');
		expect(session.getSnapshot().messages[1]?.parts.map(requireTextPart)[0]?.text).toBe(markdown);
		await session.send('Continue.', preferences.modelId);
		await ui.flush();
		expect(chat.mock.calls[1]![0].messages[1]?.parts.map(requireTextPart)[0]?.text).toBe(markdown);
	});

	it('renders fragmented streamed code and tables while scrolling and resizing above the fixed footer', async () => {
		let continueStream!: () => void;
		const continued = new Promise<void>(resolve => {continueStream = resolve;});
		const code = Array.from({length: 40}, (_, index) => `const row${index + 1} = ${index + 1};`).join('\n');
		const session = new ChatSession(async function* () {
			yield {type: 'text-delta', text: '# Streamed result\n\n```typescript\n' + code};
			await continued;
			yield {type: 'text-delta', text: '\n```\n\n| Name | Description |\n| --- | --- |\n| Widget | A lengthy explanation with several words |\n\n**Finished**'};
			yield {type: 'done', durationMs: 1};
		});
		const ui = renderWorkspace(session);
		const sending = session.send('Render this.', preferences.modelId);
		await vi.waitFor(() => expect(ui.frame()).toContain('const row40 = 40;'));
		expect(ui.frame()).not.toContain('```');
		for (let step = 0; step < 20; step++) ui.wheel('up');
		await vi.waitFor(() => expect(ui.frame()).toContain('Streamed result'));
		expect(ui.frame()).toContain('const row1 = 1;');
		const reading = ui.frame().split('\n').slice(0, 18).join('\n');
		continueStream();
		await sending;
		await ui.flush();
		expect(ui.frame().split('\n').slice(0, 18).join('\n')).toBe(reading);
		for (let step = 0; step < 25; step++) ui.wheel('down');
		await vi.waitFor(() => expect(ui.frame()).toContain('Finished'));
		expect(ui.frame()).toContain('Widget');
		ui.stdout.columns = 30;
		ui.stdout.rows = 16;
		ui.stdout.emit('resize');
		await vi.waitFor(() => expect(ui.frame().trimEnd().split('\n')).toHaveLength(16));
		expect(ui.frame()).toContain('Widget');
		expect(ui.frame()).not.toContain('**Finished**');
		expect(ui.frame().trimEnd().split('\n').at(-1)).toContain('git:main');
		for (let step = 0; step < 35; step++) ui.wheel('up');
		await vi.waitFor(() => expect(ui.frame()).toContain('Welcome to CodeYantram.'));
		for (let step = 0; step < 3; step++) ui.wheel('down');
		await vi.waitFor(() => expect(ui.frame()).toContain('const row1 = 1;'));
		expect(ui.frame().trimEnd().split('\n').at(-1)).toContain('git:main');
	});

	it('lets the mouse reach every line of a long answer while the input and status stay at the bottom', async () => {
		const text = Array.from({length: 60}, (_value, index) => `Line ${index + 1}`).join('\n');
		vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response([
			{type: 'start', messageId: 'assistant-1'}, {type: 'text-delta', text}, {type: 'done', durationMs: 1},
		].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {headers: {'content-type': 'text/event-stream'}})));
		const ui = renderUI(<App registry={registry} initialThemeId="konkan" initialModelPreferences={preferences} serverBaseUrl="http://localhost" workspaceRoot={process.cwd()} initializeGraph={initializeGraph} />);
		await vi.waitFor(() => expect(ui.stdin.setRawMode).toHaveBeenCalled());
		ui.stdin.write('Long answer');
		await vi.waitFor(() => expect(ui.frame()).toContain('Long answer'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Line 60'));
		expect(ui.frame()).toContain('Enter to send');
		expect(ui.frame()).toContain('Mouse/trackpad scroll history');
		expect(ui.frame()).not.toContain('PgUp/PgDn');
		const transcript = ui.frame();
		ui.stdin.write('\x1b[5~');
		ui.stdin.write('\x1b[6~');
		await ui.flush();
		expect(ui.frame()).toBe(transcript);
		for (let step = 0; step < 30; step++) ui.wheel('up');
		await vi.waitFor(() => expect(ui.frame()).toContain('Welcome to CodeYantram.'));
		ui.wheel('down');
		await vi.waitFor(() => expect(ui.frame()).toContain('Line 1\n'));
		const seen = new Set<number>();
		for (let step = 0; step < 25; step++) {
			for (const match of ui.frame().matchAll(/Line (\d+)/g)) seen.add(Number(match[1]));
			const rows = ui.frame().trimEnd().split('\n');
			expect(rows).toHaveLength(24);
			expect(rows[23]).toContain('git:');
			expect(rows.at(-3)).toContain('›');
			ui.wheel('down');
			await ui.flush();
		}
		expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({length: 60}, (_, index) => index + 1));
		ui.stdout.columns = 40;
		ui.stdout.rows = 16;
		ui.stdout.emit('resize');
		await vi.waitFor(() => expect(ui.frame().trimEnd().split('\n')).toHaveLength(16));
		expect(ui.frame().trimEnd().split('\n').at(-1)).toContain('git:');
		for (let step = 0; step < 30; step++) ui.wheel('up');
		await vi.waitFor(() => expect(ui.frame()).toContain('Welcome to CodeYantram.'));
		for (let step = 0; step < 2; step++) ui.wheel('down');
		await vi.waitFor(() => expect(ui.frame()).toContain('Line 1\n'));
	});

	it('uses terminal mouse reporting without leaking packets into the prompt and clears active history', async () => {
		const answer = Array.from({length: 60}, (_, index) => `SCROLLBACK_ROW_${index + 1}`).join('\n');
		let turn = 0;
		const chat = vi.fn<ChatTransport>().mockImplementation(async function* () {
			yield {type: 'start', messageId: `assistant-${++turn}`};
			yield {type: 'text-delta', text: turn === 1 ? answer : `NEW_REPLY_${turn}`};
			yield {type: 'done', durationMs: 1};
		});
		const session = new ChatSession(chat);
		await session.send('ORIGINAL_QUESTION', preferences.modelId);
		const ui = renderWorkspace(session, {debug: false});
		await vi.waitFor(() => expect(ui.output()).toContain('SCROLLBACK_ROW_60'));
		await ui.flush();
		expect(ui.output()).toContain('\x1b[?1049h');
		expect(ui.output()).toContain('\x1b[?1000h');
		ui.wheel('up');
		ui.stdin.write('\x1b[<0;2;3M\x1b[<0;2;3m');
		const beforeEdit = ui.output().length;
		ui.stdin.write('Next question');
		await vi.waitFor(() => expect(ui.output().slice(beforeEdit)).toContain('Next question'));
		await ui.flush();
		ui.stdout.columns = 40;
		ui.stdout.rows = 16;
		ui.stdout.emit('resize');
		await ui.flush();
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(session.getSnapshot().messages.at(-1)?.parts.map(requireTextPart)[0]?.text).toBe('NEW_REPLY_2'));
		await ui.flush();
		expect(chat.mock.calls[1]![0].messages.map(message => message.parts.map(requireTextPart)[0]?.text)).toEqual(['ORIGINAL_QUESTION', answer, 'Next question']);
		const beforeClear = ui.output().length;
		session.clear();
		await vi.waitFor(() => expect(ui.output().slice(beforeClear)).toContain('Type a message'));
		await session.send('FRESH_QUESTION', preferences.modelId);
		await ui.flush();
		expect(ui.output().slice(beforeClear)).toContain('FRESH_QUESTION');
		expect(ui.output().slice(beforeClear)).toContain('NEW_REPLY_3');
		expect(ui.output().slice(beforeClear)).not.toContain('ORIGINAL_QUESTION');
		expect(chat.mock.calls[2]![0].messages.map(message => message.parts.map(requireTextPart)[0]?.text)).toEqual(['FRESH_QUESTION']);
	});

	it.each(['cancelled', 'failed'] as const)('keeps %s partial output accessible by mouse after the next turn', async status => {
		const partial = Array.from({length: 40}, (_, index) => `PARTIAL_ROW_${index + 1}`).join('\n');
		const chat = vi.fn<ChatTransport>().mockImplementationOnce(async function* (_request, signal) {
			yield {type: 'text-delta', text: partial};
			if (status === 'failed') yield {type: 'error', code: 'provider_error', message: 'Interrupted provider.'};
			else await new Promise<void>(resolve => {
				if (signal.aborted) resolve();
				else signal.addEventListener('abort', () => resolve(), {once: true});
			});
		}).mockImplementation(async function* () {
			yield {type: 'text-delta', text: 'FOLLOW_UP_REPLY'};
			yield {type: 'done', durationMs: 1};
		});
		const session = new ChatSession(chat);
		const ui = renderWorkspace(session, {debug: false});
		const sending = session.send('Show partial work.', preferences.modelId);
		await vi.waitFor(() => expect(ui.output()).toContain('PARTIAL_ROW_40'));
		if (status === 'cancelled') ui.stdin.write('\x1b');
		await sending;
		await ui.flush();
		expect(session.getSnapshot().messages.at(-1)).toMatchObject({status, parts: [{type: 'text', text: partial}]});
		const beforeNext = ui.output().length;
		await session.send('Continue.', preferences.modelId);
		await ui.flush();
		expect(ui.output().slice(beforeNext)).toContain('FOLLOW_UP_REPLY');
		const beforeScroll = ui.output().length;
		for (let step = 0; step < 25; step++) ui.wheel('up');
		await ui.flush();
		expect(ui.output().slice(beforeScroll)).toContain('PARTIAL_ROW_1');
		expect(chat.mock.calls[1]![0].messages[1]?.parts.map(requireTextPart)[0]?.text).toBe(partial);
	});

	it('pins controls for empty and short conversations and ignores mouse scrolling over the footer or pickers', async () => {
		const session = new ChatSession(async function* () {
			yield {type: 'text-delta', text: 'Short reply.'};
			yield {type: 'done', durationMs: 1};
		});
		const ui = renderWorkspace(session);
		await vi.waitFor(() => expect(ui.frame()).toContain('Type a message'));
		const checkFooter = () => {
			const lines = ui.frame().trimEnd().split('\n');
			expect(lines).toHaveLength(ui.stdout.rows);
			expect(lines.at(-1)).toContain('git:main');
			expect(lines.at(-3)).toContain('›');
		};
		checkFooter();
		await session.send('Short question.', preferences.modelId);
		await ui.flush();
		checkFooter();
		const beforeWheel = ui.frame();
		ui.wheel('up', 24);
		await ui.flush();
		expect(ui.frame()).toBe(beforeWheel);
		ui.stdin.write('/model');
		await vi.waitFor(() => expect(ui.frame()).toContain('Commands ·'));
		ui.stdin.write('\r');
		await vi.waitFor(() => expect(ui.frame()).toContain('Choose a model'));
		const picker = ui.frame();
		ui.wheel('up');
		await ui.flush();
		expect(ui.frame()).toBe(picker);
		checkFooter();
	});

	it('preserves the mouse reading position when streamed text grows and returns to new output when scrolling down', async () => {
		let continueStream!: () => void;
		let finishStream!: () => void;
		const continued = new Promise<void>(resolve => {continueStream = resolve;});
		const finished = new Promise<void>(resolve => {finishStream = resolve;});
		const session = new ChatSession(async function* () {
			yield {type: 'text-delta', text: Array.from({length: 40}, (_, index) => `STREAM_ROW_${index + 1}`).join('\n')};
			await continued;
			yield {type: 'text-delta', text: '\nNEW_STREAMED_OUTPUT'};
			await finished;
			yield {type: 'done', durationMs: 1};
		});
		const ui = renderWorkspace(session);
		const sending = session.send('Stream a long reply.', preferences.modelId);
		await vi.waitFor(() => expect(ui.frame()).toContain('STREAM_ROW_40'));
		for (let step = 0; step < 25; step++) ui.wheel('up');
		await vi.waitFor(() => expect(ui.frame()).toContain('STREAM_ROW_1\n'));
		const reading = ui.frame().split('\n').slice(0, 18).join('\n');
		continueStream();
		await vi.waitFor(() => expect(session.getSnapshot().messages.at(-1)?.parts.map(requireTextPart)[0]?.text).toContain('NEW_STREAMED_OUTPUT'));
		await ui.flush();
		expect(ui.frame().split('\n').slice(0, 18).join('\n')).toBe(reading);
		for (let step = 0; step < 25; step++) ui.wheel('down');
		await vi.waitFor(() => expect(ui.frame()).toContain('NEW_STREAMED_OUTPUT'));
		expect(ui.frame().trimEnd().split('\n').at(-1)).toContain('git:main');
		finishStream();
		await sending;
	});
});
