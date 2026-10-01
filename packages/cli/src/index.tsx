import {render} from 'ink';
import {App} from './app.js';
import {loadThemes, readThemePreference} from './theme/utils/index.js';

const [registry, themeId] = await Promise.all([
	loadThemes(),
	readThemePreference(),
]);

const {selected: theme, usedFallback} = registry.resolve(themeId ?? '');
if (usedFallback) {
	process.stderr.write(`Theme "${themeId ?? ''}" is not available; using "${theme.theme.id}".\n`);
}
process.stdout.write('\x1b[2J\x1b[H');
render(<App registry={registry} initialThemeId={theme.theme.id} />);
