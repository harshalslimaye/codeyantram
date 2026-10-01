export const THEME_ROLES = [
	'text',
	'muted',
	'primary',
	'border',
	'prompt',
	'status',
	'success',
	'warning',
	'error',
] as const;

export type ThemeRole = (typeof THEME_ROLES)[number];
export type HexColor = `#${string}`;
export type AnsiColor = number;
export type ThemeColorValue = HexColor | AnsiColor | 'none';
export type ThemeColor =
	| ThemeColorValue
	| {dark: ThemeColorValue | string; light: ThemeColorValue | string}
	| string;

export type ThemePalette = Record<ThemeRole, ThemeColor>;

export interface ThemeDefinition {
	id: string;
	name: string;
	defs?: Record<string, ThemeColorValue>;
	colors: ThemePalette;
}
