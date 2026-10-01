import type {ThemeColor, ThemeDefinition, ThemeRole} from '../registry/types.js';

export interface ColorOutput {
	isTTY?: boolean;
	getColorDepth?: (env?: NodeJS.ProcessEnv) => number;
}

const ANSI_16_RGB = [
	[0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0],
	[0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229],
	[127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0],
	[92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
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
	if (index >= 232) {
		const gray = 8 + (index - 232) * 10;
		return [gray, gray, gray];
	}
	const value = index - 16;
	const levels = [0, 95, 135, 175, 215, 255];
	return [levels[Math.floor(value / 36)], levels[Math.floor(value / 6) % 6], levels[value % 6]];
}

function nearestAnsiIndex(rgb: readonly number[], depth: 4 | 8): number {
	const candidates = depth === 4 ? 16 : 256;
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
	if (depth >= 24) return color;
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
