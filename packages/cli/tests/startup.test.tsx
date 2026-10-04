import {realpath} from 'node:fs/promises';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
	loadThemes: vi.fn(), readThemePreference: vi.fn(), readModelPreferences: vi.fn(),
	startChatServer: vi.fn(), createTerminalInput: vi.fn(), render: vi.fn(),
	runInit: vi.fn(),
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
vi.mock('../src/lib/init.js', () => ({runInit: mocks.runInit}));

const preferences = {modelId: 'gpt-6.1-sol', effortByModel: {}};
const registry = {resolve: mocks.resolve};
let finish: () => void;
let fail: (error: Error) => void;
let previousArgv: string[];
let previousExitCode: typeof process.exitCode;

beforeEach(() => {
	previousArgv = process.argv;
	previousExitCode = process.exitCode;
	process.argv = [process.execPath, 'codeyantram'];
	vi.stubEnv('INIT_CWD', process.cwd());
	vi.resetModules();
	vi.resetAllMocks();
	mocks.loadThemes.mockResolvedValue(registry);
	mocks.runInit.mockResolvedValue(0);
	mocks.readThemePreference.mockResolvedValue('konkan');
	mocks.readModelPreferences.mockResolvedValue(preferences);
	mocks.resolve.mockReturnValue({selected: {theme: {id: 'konkan'}}, usedFallback: false});
	mocks.startChatServer.mockResolvedValue({baseUrl: 'http://localhost:1234', close: mocks.close});
	mocks.createTerminalInput.mockReturnValue({stdin: 'filtered-input', dispose: mocks.dispose});
	mocks.waitUntilExit.mockReturnValue(new Promise<void>((resolve, reject) => {finish = resolve; fail = reject;}));
	mocks.unmount.mockImplementation(() => finish());
	mocks.render.mockReturnValue({waitUntilExit: mocks.waitUntilExit, unmount: mocks.unmount});
});

afterEach(() => {
	process.argv = previousArgv;
	process.exitCode = previousExitCode;
});

describe('CLI startup lifecycle', () => {
	it.each([0, 1, 130])('runs init for the selected root and forwards exit code %s without starting chat', async exitCode => {
		process.argv.push('init', '--project', 'packages/shared');
		mocks.runInit.mockResolvedValue(exitCode);
		await import('../src/index.js');
		expect(mocks.runInit).toHaveBeenCalledExactlyOnceWith(await realpath('packages/shared'));
		expect(process.exitCode).toBe(exitCode);
		expect(mocks.loadThemes).not.toHaveBeenCalled();
		expect(mocks.readModelPreferences).not.toHaveBeenCalled();
		expect(mocks.startChatServer).not.toHaveBeenCalled();
		expect(mocks.createTerminalInput).not.toHaveBeenCalled();
		expect(mocks.render).not.toHaveBeenCalled();
	});

	it('prints init help without opening a project graph', async () => {
		process.argv.push('init', '--help');
		const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
		await import('../src/index.js');
		expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Build or refresh the project code graph'));
		expect(mocks.runInit).not.toHaveBeenCalled();
		expect(mocks.startChatServer).not.toHaveBeenCalled();
	});

	it('validates the init project before opening a graph', async () => {
		process.argv.push('init', '--project', 'missing-codeyantram-init-project');
		vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		await import('../src/index.js');
		expect(process.exitCode).toBe(1);
		expect(mocks.runInit).not.toHaveBeenCalled();
	});
	it('loads preferences, renders the selected theme and model, and cleans up after exit', async () => {
		const once = vi.spyOn(process, 'once');
		const off = vi.spyOn(process, 'off');
		const running = import('../src/index.js');
		await vi.waitFor(() => expect(mocks.waitUntilExit).toHaveBeenCalledOnce());
		expect(mocks.resolve).toHaveBeenCalledWith('konkan');
		expect(mocks.createTerminalInput).toHaveBeenCalledWith(process.stdin, process.stdout);
		const [node, options] = mocks.render.mock.calls[0]!;
		expect(options).toEqual({stdin: 'filtered-input', alternateScreen: true});
		const workspaceRoot = await realpath(process.cwd());
		expect(mocks.startChatServer).toHaveBeenCalledExactlyOnceWith({workspaceRoot});
		expect(node.props.children.props).toEqual({registry, initialThemeId: 'konkan', initialModelPreferences: preferences, serverBaseUrl: 'http://localhost:1234', workspaceRoot});
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

	it('passes an explicit project root to the server and UI', async () => {
		process.argv.push('--project', 'packages/shared');
		const running = import('../src/index.js');
		await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
		const workspaceRoot = await realpath('packages/shared');
		expect(mocks.startChatServer).toHaveBeenCalledExactlyOnceWith({workspaceRoot});
		expect(mocks.render.mock.calls[0]![0].props.children.props.workspaceRoot).toBe(workspaceRoot);
		finish();
		await running;
	});

	it('prints help without loading configuration or starting terminal/server resources', async () => {
		process.argv.push('--help');
		const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
		await import('../src/index.js');
		expect(stdout).toHaveBeenCalledWith(expect.stringContaining('--project <directory>'));
		expect(mocks.loadThemes).not.toHaveBeenCalled();
		expect(mocks.readModelPreferences).not.toHaveBeenCalled();
		expect(mocks.startChatServer).not.toHaveBeenCalled();
		expect(mocks.createTerminalInput).not.toHaveBeenCalled();
	});

	it.each([['--project'], ['--project', 'package.json'], ['--project', 'missing-codeyantram-project']].map(args => ({args})))(
		'rejects invalid projects before starting resources: $args', async ({args}) => {
			process.argv.push(...args);
			const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
			await import('../src/index.js');
			expect(process.exitCode).toBe(1);
			expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Could not start Codeyantram:'));
			expect(mocks.loadThemes).not.toHaveBeenCalled();
			expect(mocks.startChatServer).not.toHaveBeenCalled();
			expect(mocks.createTerminalInput).not.toHaveBeenCalled();
		},
	);

	it('closes the server if terminal input setup fails', async () => {
		mocks.createTerminalInput.mockImplementation(() => {throw new Error('terminal setup failed');});
		await expect(import('../src/index.js')).rejects.toThrow('terminal setup failed');
		expect(mocks.close).toHaveBeenCalledOnce();
		expect(mocks.render).not.toHaveBeenCalled();
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
