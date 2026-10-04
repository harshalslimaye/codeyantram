import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
	loadThemes: vi.fn(), readThemePreference: vi.fn(), readModelPreferences: vi.fn(),
	startChatServer: vi.fn(), createTerminalInput: vi.fn(), render: vi.fn(),
	resolve: vi.fn(), dispose: vi.fn(), close: vi.fn(), unmount: vi.fn(), waitUntilExit: vi.fn(),
}));
vi.mock('ink', () => ({render: mocks.render}));
vi.mock('../src/app.js', () => ({App: () => null}));
vi.mock('../src/terminal/mouse.js', () => ({MouseProvider: () => null}));
vi.mock('../src/theme/utils/index.js', () => ({loadThemes: mocks.loadThemes, readThemePreference: mocks.readThemePreference}));
vi.mock('@codeyantram/shared', async importOriginal => ({
	...await importOriginal<typeof import('@codeyantram/shared')>(),
	readModelPreferences: mocks.readModelPreferences,
}));
vi.mock('../src/chat/server.js', () => ({startChatServer: mocks.startChatServer}));
vi.mock('../src/terminal/input.js', () => ({createTerminalInput: mocks.createTerminalInput}));

const preferences = {modelId: 'gpt-6.1-sol', effortByModel: {}};
const registry = {resolve: mocks.resolve};
let finish: () => void;
let fail: (error: Error) => void;

beforeEach(() => {
	vi.resetModules();
	vi.resetAllMocks();
	mocks.loadThemes.mockResolvedValue(registry);
	mocks.readThemePreference.mockResolvedValue('konkan');
	mocks.readModelPreferences.mockResolvedValue(preferences);
	mocks.resolve.mockReturnValue({selected: {theme: {id: 'konkan'}}, usedFallback: false});
	mocks.startChatServer.mockResolvedValue({baseUrl: 'http://localhost:1234', close: mocks.close});
	mocks.createTerminalInput.mockReturnValue({stdin: 'filtered-input', dispose: mocks.dispose});
	mocks.waitUntilExit.mockReturnValue(new Promise<void>((resolve, reject) => {finish = resolve; fail = reject;}));
	mocks.unmount.mockImplementation(() => finish());
	mocks.render.mockReturnValue({waitUntilExit: mocks.waitUntilExit, unmount: mocks.unmount});
});

describe('CLI startup lifecycle', () => {
	it('loads preferences, renders the selected theme and model, and cleans up after exit', async () => {
		const once = vi.spyOn(process, 'once');
		const off = vi.spyOn(process, 'off');
		const running = import('../src/index.js');
		await vi.waitFor(() => expect(mocks.waitUntilExit).toHaveBeenCalledOnce());
		expect(mocks.resolve).toHaveBeenCalledWith('konkan');
		expect(mocks.createTerminalInput).toHaveBeenCalledWith(process.stdin, process.stdout);
		const [node, options] = mocks.render.mock.calls[0]!;
		expect(options).toEqual({stdin: 'filtered-input', alternateScreen: true});
		expect(node.props.children.props).toEqual({registry, initialThemeId: 'konkan', initialModelPreferences: preferences, serverBaseUrl: 'http://localhost:1234'});
		finish();
		await running;
		expect(mocks.dispose).toHaveBeenCalledOnce();
		expect(mocks.close).toHaveBeenCalledOnce();
		for (const signal of ['SIGINT', 'SIGTERM'] as const) {
			const handler = once.mock.calls.find(([name]) => name === signal)![1];
			expect(off).toHaveBeenCalledWith(signal, handler);
			expect(process.listeners(signal)).not.toContain(handler);
		}
	});

	it.each(['missing', undefined])('reports a fallback theme for preference %s', async theme => {
		mocks.readThemePreference.mockResolvedValue(theme);
		mocks.resolve.mockReturnValue({selected: {theme: {id: 'konkan'}}, usedFallback: true});
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		const running = import('../src/index.js');
		await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
		expect(mocks.resolve).toHaveBeenCalledWith(theme ?? '');
		expect(stderr).toHaveBeenCalledWith(`Theme "${theme ?? ''}" is not available; using "konkan".\n`);
		finish();
		await running;
	});

	it.each(['SIGINT', 'SIGTERM'])('unmounts and closes resources on %s', async signal => {
		const once = vi.spyOn(process, 'once');
		const running = import('../src/index.js');
		await vi.waitFor(() => expect(mocks.waitUntilExit).toHaveBeenCalledOnce());
		const handler = once.mock.calls.find(([name]) => name === signal)![1] as () => void;
		handler();
		await running;
		expect(mocks.unmount).toHaveBeenCalledOnce();
		expect(mocks.dispose).toHaveBeenCalledOnce();
		expect(mocks.close).toHaveBeenCalledOnce();
	});

	it('cleans up the terminal and server when rendering fails', async () => {
		mocks.render.mockImplementation(() => {throw new Error('render failed');});
		await expect(import('../src/index.js')).rejects.toThrow('render failed');
		expect(mocks.dispose).toHaveBeenCalledOnce();
		expect(mocks.close).toHaveBeenCalledOnce();
	});

	it('removes signal handlers and cleans up resources when the app fails', async () => {
		const off = vi.spyOn(process, 'off');
		const running = import('../src/index.js');
		const assertion = expect(running).rejects.toThrow('app failed');
		await vi.waitFor(() => expect(mocks.waitUntilExit).toHaveBeenCalledOnce());
		fail(new Error('app failed'));
		await assertion;
		expect(off).toHaveBeenCalledWith('SIGINT', expect.any(Function));
		expect(off).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
		expect(mocks.dispose).toHaveBeenCalledOnce();
		expect(mocks.close).toHaveBeenCalledOnce();
	});
});
