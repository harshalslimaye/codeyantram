import {render} from 'ink';
import {App} from './app.js';
import {loadThemes, readThemePreference} from './theme/utils/index.js';
import {readModelPreferences} from '@codeyantram/shared';
import {startChatServer} from './chat/server.js';
import {createTerminalInput} from './terminal/input.js';
import {MouseProvider} from './terminal/mouse.js';

const [registry, themeId, modelPreferences] = await Promise.all([
	loadThemes(),
	readThemePreference(),
	readModelPreferences(),
]);

const {selected: theme, usedFallback} = registry.resolve(themeId ?? '');
if (usedFallback) {
	process.stderr.write(`Theme "${themeId ?? ''}" is not available; using "${theme.theme.id}".\n`);
}
const server = await startChatServer();
const terminalInput = createTerminalInput(process.stdin, process.stdout);
try {
	const app = render(
		<MouseProvider value={terminalInput}>
			<App registry={registry} initialThemeId={theme.theme.id} initialModelPreferences={modelPreferences} serverBaseUrl={server.baseUrl} />
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
	await server.close();
}
