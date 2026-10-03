import {describe, expect, it} from 'vitest';
import {konkanTheme} from '../../../src/theme/builtins/konkan.js';
import {createThemeRegistry, type RegisteredTheme} from '../../../src/theme/registry/registry.js';

const builtin: RegisteredTheme = {theme: konkanTheme, source: 'builtin'};

describe('theme registry', () => {
	it('lets a user theme override a builtin with the same id', () => {
		const custom: RegisteredTheme = {
			theme: {...konkanTheme, name: 'My Konkan'},
			source: 'user',
			filePath: '/themes/konkan.json',
		};
		const registry = createThemeRegistry([
			{source: 'builtin', themes: [builtin]},
			{source: 'user', themes: [custom]},
		]);
		expect(registry.get('konkan')).toEqual(custom);
		expect(registry.list()).toEqual([custom]);
	});

	it('lists themes by display name', () => {
		const alpha: RegisteredTheme = {theme: {...konkanTheme, id: 'alpha', name: 'Alpha'}, source: 'user'};
		const registry = createThemeRegistry([{source: 'builtin', themes: [builtin, alpha]}]);
		expect(registry.list().map(entry => entry.theme.id)).toEqual(['alpha', 'konkan']);
	});

	it('selects a registered theme without using a fallback', () => {
		const registry = createThemeRegistry([{source: 'builtin', themes: [builtin]}]);
		expect(registry.resolve('konkan')).toEqual({selected: builtin, requestedId: 'konkan', usedFallback: false});
	});

	it('falls back for an unknown id and preserves the requested id', () => {
		const registry = createThemeRegistry([{source: 'builtin', themes: [builtin]}]);
		expect(registry.resolve('missing')).toEqual({selected: builtin, requestedId: 'missing', usedFallback: true});
		expect(registry.resolve(undefined)).toEqual({selected: builtin, requestedId: undefined, usedFallback: false});
	});

	it('reports a missing fallback theme', () => {
		expect(() => createThemeRegistry([]).resolve('missing')).toThrow('Fallback theme "konkan" is not registered.');
	});
});
