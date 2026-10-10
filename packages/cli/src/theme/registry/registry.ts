import type {ThemeDefinition} from './types.js';

export type ThemeSource = 'builtin' | 'user';

export interface RegisteredTheme {
	theme: ThemeDefinition;
	source: ThemeSource;
	filePath?: string;
}

export interface ThemeRegistry {
	list(): RegisteredTheme[];
	get(id: string): RegisteredTheme | undefined;
	resolve(id?: string, fallbackId?: string): {
		selected: RegisteredTheme;
		requestedId?: string;
		usedFallback: boolean;
	};
}

export interface ThemeLayer {
	source: ThemeSource;
	themes: RegisteredTheme[];
}

export function createThemeRegistry(layers: ThemeLayer[]): ThemeRegistry {
	const themes = new Map<string, RegisteredTheme>();
	for (const layer of layers) {
		for (const entry of layer.themes) themes.set(entry.theme.id, entry);
	}

	return {
		list: () => [...themes.values()].sort((left, right) => left.theme.name.localeCompare(right.theme.name)),
		get: id => themes.get(id),
		resolve: (id, fallbackId = 'konkan') => {
			const selected = (id !== undefined && id !== '') ? themes.get(id) : undefined;
			if (selected) return {selected, requestedId: id, usedFallback: false};

			const fallback = themes.get(fallbackId);
			if (!fallback) throw new Error(`Fallback theme "${fallbackId}" is not registered.`);
			return {selected: fallback, requestedId: id, usedFallback: Boolean(id)};
		},
	};
}
