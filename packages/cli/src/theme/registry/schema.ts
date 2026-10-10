import {THEME_ROLES, type ThemeColor, type ThemeColorValue, type ThemeDefinition, type ThemeRole} from './types.js';

const THEME_VARIANT_COUNT = 2;

const MAX_ANSI_COLOR = 255;

const HEX_COLOR_PATTERN = /^#[\da-fA-F]{6}$/;
const DEFINITION_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface ThemeValidationResult {
	success: boolean;
	data?: ThemeDefinition;
	errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isColorValue(value: unknown): value is ThemeColorValue {
	return value === 'none'
		|| (typeof value === 'string' && HEX_COLOR_PATTERN.test(value))
		|| (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_ANSI_COLOR);
}

function isDefinitionReference(value: unknown, definitions: Record<string, ThemeColorValue>): value is string {
	return typeof value === 'string' && Object.hasOwn(definitions, value);
}

function isThemeColor(value: unknown, definitions: Record<string, ThemeColorValue>): value is ThemeColor {
	if (isColorValue(value) || isDefinitionReference(value, definitions)) return true;
	if (!isRecord(value)) return false;

	const keys = Object.keys(value);
	return keys.length === THEME_VARIANT_COUNT
		&& keys.includes('dark')
		&& keys.includes('light')
		&& [value.dark, value.light].every(
			variant => isColorValue(variant) || isDefinitionReference(variant, definitions),
		);
}

/** Validate a parsed custom theme object before the CLI uses any of its colors. */
export function validateTheme(value: unknown): ThemeValidationResult {
	const errors: string[] = [];
	if (!isRecord(value)) {
		return {success: false, errors: ['Theme must be a JSON object.']};
	}

	for (const key of Object.keys(value)) {
		if (!['id', 'name', 'defs', 'colors', '$schema'].includes(key)) {
			errors.push(`Unknown theme field "${key}".`);
		}
	}

	if (typeof value.id !== 'string' || !THEME_ID_PATTERN.test(value.id)) {
		errors.push('"id" must be a lowercase theme identifier containing letters, numbers, and hyphens.');
	}

	if (typeof value.name !== 'string' || value.name.trim().length === 0) {
		errors.push('"name" must be a non-empty string.');
	}

	const definitions = validateDefinitions(value.defs, errors);

	validateColors(value.colors, definitions, errors);

	if (errors.length > 0) return {success: false, errors};

	return {
		success: true,
		data: value as unknown as ThemeDefinition,
		errors: [],
	};
}

export function isThemeRole(value: string): value is ThemeRole {
	return (THEME_ROLES as readonly string[]).includes(value);
}

function validateDefinitions(value: unknown, errors: string[]): Record<string, ThemeColorValue> {
	const definitions: Record<string, ThemeColorValue> = {};
	if (value === undefined) return definitions;
	if (!isRecord(value)) {
		errors.push('"defs" must be an object of reusable color values.');
		return definitions;
	}
	for (const [name, color] of Object.entries(value)) {
		if (!DEFINITION_NAME_PATTERN.test(name)) errors.push(`Invalid definition name "${name}".`);
		else if (!isColorValue(color)) errors.push(`"defs.${name}" must be a 6-digit hex color, an ANSI index from 0 to 255, or "none".`);
		else definitions[name] = color; // oxlint-disable-line security/detect-object-injection -- Names are validated against the definition-name schema.
	}
	return definitions;
}

function validateColors(value: unknown, definitions: Record<string, ThemeColorValue>, errors: string[]) {
	if (!isRecord(value)) {
		errors.push('"colors" must be an object containing every theme role.');
	} else {
		const allowedRoles = new Set<string>(THEME_ROLES);
		for (const key of Object.keys(value)) {
			if (!allowedRoles.has(key)) errors.push(`Unknown color role "${key}".`);
		}
		for (const role of THEME_ROLES) {
			if (!Object.hasOwn(value, role)) {
				errors.push(`Missing required color role "${role}".`);
			} else if (!isThemeColor(value[role], definitions)) { // oxlint-disable-line security/detect-object-injection -- Definition names and role keys are validated against the theme schema before use.
				errors.push(`"colors.${role}" must be a hex color, ANSI index, "none", a defined color name, or a dark/light pair of those values.`);
			}
		}
	}

}
