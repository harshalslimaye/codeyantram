import {render} from 'ink';
import {App} from './app.js';
import {loadThemes, readThemePreference} from './theme/utils/index.js';
import {readModelPreferences} from '@codeyantram/shared';
import {startChatServer} from './chat/server.js';
import {createTerminalInput} from './terminal/input.js';
import {MouseProvider} from './terminal/mouse.js';
import {CLI_USAGE, parseCliOptions, resolveProjectRoot, type CliOptions} from './lib/project.js';

const PROCESS_ARGUMENTS_PREFIX_LENGTH = 2;

async function main() {
	let workspaceRoot: string;
	let options: CliOptions;
	try {
		options = parseCliOptions(process.argv.slice(PROCESS_ARGUMENTS_PREFIX_LENGTH));
		if (options.help) {
			process.stdout.write(CLI_USAGE);
			return;
		}
		workspaceRoot = await resolveProjectRoot({project: options.project});
	} catch (error) {
		process.stderr.write(`Could not start Codeyantram: ${error instanceof Error ? error.message : 'Invalid project options.'}\n\n${CLI_USAGE}`);
		process.exitCode = 1;
		return;
	}

	if (options.command === 'init') {
		const {runInit} = await import('./lib/init.js');
		process.exitCode = await runInit(workspaceRoot);
		return;
	}

	await startInteractiveChat(workspaceRoot);
}

async function startInteractiveChat(workspaceRoot: string) {
	const [registry, themeId, modelPreferences] = await Promise.all([
		loadThemes(),
		readThemePreference(),
		readModelPreferences(),
	]);

	const {selected: theme, usedFallback} = registry.resolve(themeId ?? '');
	if (usedFallback) {
		process.stderr.write(`Theme "${themeId ?? ''}" is not available; using "${theme.theme.id}".\n`);
	}
	const server = await startChatServer({workspaceRoot});
	try {
		const terminalInput = createTerminalInput(process.stdin, process.stdout);
		try {
			const app = render(
				<MouseProvider value={terminalInput}>
					<App registry={registry} initialThemeId={theme.theme.id} initialModelPreferences={modelPreferences} serverBaseUrl={server.baseUrl} workspaceRoot={workspaceRoot} initializeGraph={server.initializeGraph} />
				</MouseProvider>,
				{stdin: terminalInput.stdin, alternateScreen: true},
			);
			const shutdown = () => app.unmount();
			process.once('SIGINT', shutdown);
			process.once('SIGTERM', shutdown);
			try {
				await app.waitUntilExit();
			} finally {
				process.off('SIGINT', shutdown);
				process.off('SIGTERM', shutdown);
			}
		} finally {
			terminalInput.dispose();
		}
	} finally {
		await server.close();
	}
}

await main();
