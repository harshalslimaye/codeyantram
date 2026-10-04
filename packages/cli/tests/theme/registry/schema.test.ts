import {describe, expect, it} from 'vitest';
import {validateTheme, isThemeRole} from '../../../src/theme/registry/schema.js';
import {THEME_ROLES} from '../../../src/theme/registry/types.js';
import {konkanTheme} from '../../../src/theme/builtins/konkan.js';

describe('custom theme validation', () => {
	it.each([null, undefined, [], 'theme', 42])('rejects a non-object theme: %j', value => {
		expect(validateTheme(value)).toEqual({success: false, errors: ['Theme must be a JSON object.']});
	});

	it.each(['#abcdef', '#ABCDEF', 0, 255, 'none', 'accent', {dark: '#123456', light: 42}, {dark: 'accent', light: 'none'}])(
		'accepts a supported color or reference: %j', color => {
			const theme = {...konkanTheme, defs: {accent: '#123456'}, colors: {...konkanTheme.colors, primary: color}, $schema: 'theme.schema.json'};
			expect(validateTheme(theme)).toEqual({success: true, data: theme, errors: []});
		},
	);

	it('accepts a theme without reusable definitions', () => {
		const theme = {id: 'custom-1', name: ' Custom ', colors: Object.fromEntries(THEME_ROLES.map(role => [role, 'none']))};
		expect(validateTheme(theme)).toEqual({success: true, data: theme, errors: []});
	});

	it.each([null, -1, 256, 1.5, true, '#fff', '#gggggg', 'undefined-color', [], {},
		{dark: '#123456'}, {light: '#123456'}, {dark: 'none', light: 'none', extra: 'none'},
		{dark: 'missing', light: 'none'}, {dark: 'none', light: 'missing'}])('rejects an invalid role color: %j', primary => {
		const result = validateTheme({...konkanTheme, colors: {...konkanTheme.colors, primary}});
		expect(result.success).toBe(false);
		expect(result.errors).toEqual([expect.stringContaining('colors.primary')]);
	});

	it.each([undefined, 42, '', 'UPPERCASE', '-leading', 'has space'])('rejects an invalid identifier: %j', id => {
		expect(validateTheme({...konkanTheme, id}).errors).toEqual([expect.stringContaining('"id"')]);
	});

	it.each([undefined, 42, '', '   '])('rejects an invalid name: %j', name => {
		expect(validateTheme({...konkanTheme, name}).errors).toEqual([expect.stringContaining('"name"')]);
	});

	it.each([null, [], 'bad'])('rejects malformed definitions: %j', defs => {
		expect(validateTheme({...konkanTheme, defs}).errors).toEqual([expect.stringContaining('"defs"')]);
	});

	it('reports invalid definition names and values together', () => {
		const result = validateTheme({...konkanTheme, defs: {'1bad': 'none', valid: '#fff', valid_two: 255, validThree: 'none'}});
		expect(result.success).toBe(false);
		expect(result.errors).toEqual([expect.stringContaining('1bad'), expect.stringContaining('defs.valid')]);
	});

	it.each([undefined, null, [], 'bad'])('rejects a malformed palette: %j', colors => {
		expect(validateTheme({...konkanTheme, colors}).errors).toEqual([expect.stringContaining('"colors"')]);
	});

	it('reports unknown fields, unknown roles, and missing roles', () => {
		const {primary: _primary, ...colors} = konkanTheme.colors;
		const result = validateTheme({...konkanTheme, extra: true, colors: {...colors, extra: 'none'}});
		expect(result.success).toBe(false);
		expect(result.errors).toEqual([
			'Unknown theme field "extra".', 'Unknown color role "extra".', 'Missing required color role "primary".',
		]);
	});

	it('recognizes each supported theme role and rejects unknown roles', () => {
		for (const role of THEME_ROLES) expect(isThemeRole(role)).toBe(true);
		expect(isThemeRole('unknown')).toBe(false);
	});
});
