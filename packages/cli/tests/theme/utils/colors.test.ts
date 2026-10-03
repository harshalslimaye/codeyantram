import {describe, expect, it} from 'vitest';
import {konkanTheme} from '../../../src/theme/builtins/konkan.js';
import type {ThemeColor, ThemeDefinition} from '../../../src/theme/registry/types.js';
import {detectTerminalColorDepth, resolveThemeColor} from '../../../src/theme/utils/colors.js';

function themeWithPrimary(primary: ThemeColor): ThemeDefinition {
	return {...konkanTheme, colors: {...konkanTheme.colors, primary}};
}

describe('terminal color detection', () => {
	it('respects NO_COLOR even on a truecolor terminal', () => {
		expect(detectTerminalColorDepth({isTTY: true, getColorDepth: () => 24}, {NO_COLOR: '1'})).toBe(1);
	});

	it('disables colors for redirected output or missing terminal capabilities', () => {
		expect(detectTerminalColorDepth({isTTY: false, getColorDepth: () => 24}, {})).toBe(1);
		expect(detectTerminalColorDepth({isTTY: true}, {})).toBe(1);
	});

	it('uses the terminal depth when NO_COLOR is empty', () => {
		expect(detectTerminalColorDepth({isTTY: true, getColorDepth: () => 8}, {NO_COLOR: ''})).toBe(8);
	});
});

describe('theme color resolution', () => {
	it.each([
		[24, '#ff0000'],
		[8, 'ansi256(9)'],
		[4, 'ansi256(9)'],
		[1, undefined],
	])('converts red for color depth %i', (depth, expected) => {
		expect(resolveThemeColor(themeWithPrimary('#ff0000'), 'primary', depth)).toBe(expected);
	});

	it('resolves named colors for dark and light variants', () => {
		const theme = {
			...themeWithPrimary({dark: 'accent', light: '#ffffff'}),
			defs: {accent: '#ff0000' as const},
		};
		expect(resolveThemeColor(theme, 'primary', 24)).toBe('#ff0000');
		expect(resolveThemeColor(theme, 'primary', 24, 'light')).toBe('#ffffff');
	});

	it('reduces a 256-color index for a 16-color terminal', () => {
		expect(resolveThemeColor(themeWithPrimary(196), 'primary', 8)).toBe('ansi256(196)');
		expect(resolveThemeColor(themeWithPrimary(196), 'primary', 4)).toBe('ansi256(9)');
	});

	it.each(['none', 'missing', '#xyzxyz'])('omits color for %s', color => {
		expect(resolveThemeColor(themeWithPrimary(color), 'primary', 24)).toBeUndefined();
	});
});
