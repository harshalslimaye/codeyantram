import {render} from 'ink';
import {App} from './app.js';
import {loadThemes, readThemePreference} from './theme/utils/index.js';
import {readModelPreferences} from './models/preferences.js';
import {startChatServer} from './chat/server.js';

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
try {
	process.stdout.write('\x1b[2J\x1b[H');
	const app = render(<App registry={registry} initialThemeId={theme.theme.id} initialModelPreferences={modelPreferences} chatUrl={server.url} />);
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
	await server.close();
}
