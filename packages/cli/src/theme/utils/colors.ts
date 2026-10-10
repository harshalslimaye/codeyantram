import type {ThemeColor, ThemeDefinition, ThemeRole} from '../registry/types.js';

const ANSI_NORMAL_CHANNEL = 205;
const ANSI_BLUE_CHANNEL = 238;
const ANSI_LIGHT_GRAY_CHANNEL = 229;
const ANSI_GRAY_CHANNEL = 127;
const MAX_RGB_CHANNEL = 255;
const ANSI_BRIGHT_BLUE_CHANNEL = 92;
const GRAYSCALE_START_INDEX = 232;
const GRAYSCALE_STEP = 10;
const CUBE_LEVEL_ONE = 95;
const CUBE_LEVEL_TWO = 135;
const CUBE_LEVEL_THREE = 175;
const CUBE_LEVEL_FOUR = 215;
const CUBE_RED_STRIDE = 36;
const CUBE_CHANNEL_LEVELS = 6;
const ANSI_EXTENDED_COLOR_COUNT = 256;
const TRUE_COLOR_DEPTH = 24;

export interface ColorOutput {
	isTTY?: boolean;
	getColorDepth?: (env?: NodeJS.ProcessEnv) => number;
}

const ANSI_16_RGB = [
	[0, 0, 0], [ANSI_NORMAL_CHANNEL, 0, 0], [0, ANSI_NORMAL_CHANNEL, 0], [ANSI_NORMAL_CHANNEL, ANSI_NORMAL_CHANNEL, 0],
	[0, 0, ANSI_BLUE_CHANNEL], [ANSI_NORMAL_CHANNEL, 0, ANSI_NORMAL_CHANNEL], [0, ANSI_NORMAL_CHANNEL, ANSI_NORMAL_CHANNEL], [ANSI_LIGHT_GRAY_CHANNEL, ANSI_LIGHT_GRAY_CHANNEL, ANSI_LIGHT_GRAY_CHANNEL],
	[ANSI_GRAY_CHANNEL, ANSI_GRAY_CHANNEL, ANSI_GRAY_CHANNEL], [MAX_RGB_CHANNEL, 0, 0], [0, MAX_RGB_CHANNEL, 0], [MAX_RGB_CHANNEL, MAX_RGB_CHANNEL, 0],
	[ANSI_BRIGHT_BLUE_CHANNEL, ANSI_BRIGHT_BLUE_CHANNEL, MAX_RGB_CHANNEL], [MAX_RGB_CHANNEL, 0, MAX_RGB_CHANNEL], [0, MAX_RGB_CHANNEL, MAX_RGB_CHANNEL], [MAX_RGB_CHANNEL, MAX_RGB_CHANNEL, MAX_RGB_CHANNEL],
] as const;

function parseHexColor(color: string): [number, number, number] | undefined {
	if (!/^#[\da-fA-F]{6}$/.test(color)) return undefined;
	return [
		Number.parseInt(color.slice(1, 3), 16),
		Number.parseInt(color.slice(3, 5), 16),
		Number.parseInt(color.slice(5, 7), 16),
	];
}

function xtermColor(index: number): [number, number, number] {
	if (index < 16) return [...ANSI_16_RGB[index]];
	if (index >= GRAYSCALE_START_INDEX) {
		const gray = 8 + (index - GRAYSCALE_START_INDEX) * GRAYSCALE_STEP;
		return [gray, gray, gray];
	}
	const value = index - 16;
	const levels = [0, CUBE_LEVEL_ONE, CUBE_LEVEL_TWO, CUBE_LEVEL_THREE, CUBE_LEVEL_FOUR, MAX_RGB_CHANNEL];
	return [levels[Math.floor(value / CUBE_RED_STRIDE)], levels[Math.floor(value / CUBE_CHANNEL_LEVELS) % CUBE_CHANNEL_LEVELS], levels[value % CUBE_CHANNEL_LEVELS]];
}

function nearestAnsiIndex(rgb: readonly number[], depth: 4 | 8): number {
	const candidates = depth === 4 ? 16 : ANSI_EXTENDED_COLOR_COUNT;
	let nearestIndex = 0;
	let nearestDistance = Number.POSITIVE_INFINITY;

	for (let index = 0; index < candidates; index++) {
		const [red, green, blue] = depth === 4 ? ANSI_16_RGB[index] : xtermColor(index);
		const distance = (rgb[0] - red) ** 2 + (rgb[1] - green) ** 2 + (rgb[2] - blue) ** 2;
		if (distance < nearestDistance) {
			nearestIndex = index;
			nearestDistance = distance;
		}
	}

	return nearestIndex;
}

export function detectTerminalColorDepth(
	output: ColorOutput = process.stdout,
	env: NodeJS.ProcessEnv = process.env,
): number {
	if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return 1;
	if (!output.isTTY || !output.getColorDepth) return 1;
	return output.getColorDepth(env);
}

function resolveVariant(color: ThemeColor, mode: 'dark' | 'light'): string | number | undefined {
	if (typeof color === 'object' && color !== null) return color[mode];
	return color;
}

function resolveReference(color: string | number | undefined, theme: ThemeDefinition): string | number | undefined {
	if (typeof color !== 'string' || color.startsWith('#') || color === 'none') return color;
	return theme.defs?.[color];
}

function toInkColor(color: string | number | undefined, depth: number): string | undefined {
	if (color === undefined || color === 'none' || depth < 4) return undefined;
	if (typeof color === 'number') {
		const index = depth >= 8 || color < 16 ? color : nearestAnsiIndex(xtermColor(color), 4);
		return `ansi256(${index})`;
	}

	const rgb = parseHexColor(color);
	if (!rgb) return undefined;
	if (depth >= TRUE_COLOR_DEPTH) return color;
	const index = nearestAnsiIndex(rgb, depth >= 8 ? 8 : 4);
	return `ansi256(${index})`;
}

export function resolveThemeColor(
	theme: ThemeDefinition,
	role: ThemeRole,
	colorDepth: number,
	mode: 'dark' | 'light' = 'dark',
): string | undefined {
	const selected = resolveVariant(theme.colors[role], mode);
	return toInkColor(resolveReference(selected, theme), colorDepth);
}
