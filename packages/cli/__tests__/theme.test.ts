import { describe, test, expect } from 'bun:test';
import { themes, DEFAULT_THEME, type ThemeColors } from '../src/theme';

// Listed explicitly because interfaces are erased at runtime. The `satisfies`
// clause makes this fail to compile if ThemeColors gains or loses a key, so
// the list can't silently drift out of sync with the type.
const REQUIRED_COLOR_KEYS = Object.keys({
    bg: true,
    panel: true,
    text: true,
    accent: true,
    focus: true,
    paths: true,
    success: true,
    del: true,
    error: true,
    fill: true,
} satisfies Record<keyof ThemeColors, true>) as (keyof ThemeColors)[];

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

describe('themes', () => {
    test('at least one theme is defined', () => {
        expect(themes.length).toBeGreaterThan(0);
    });

    test('theme names are unique', () => {
        const names = themes.map(theme => theme.name);
        expect(new Set(names).size).toBe(names.length);
    });

    test('every theme has a non-empty name', () => {
        for (const theme of themes) {
            expect(theme.name).toBeTruthy();
        }
    });

    test('every theme defines every colour key', () => {
        for (const theme of themes) {
            for (const key of REQUIRED_COLOR_KEYS) {
                expect(theme.colors[key]).toBeDefined();
            }
        }
    });

    test('every theme defines only known colour keys', () => {
        for (const theme of themes) {
            expect(Object.keys(theme.colors).sort()).toEqual([...REQUIRED_COLOR_KEYS].sort());
        }
    });

    test('every colour is a valid hex value', () => {
        // Collected rather than asserted one-by-one so a failure names every
        // offending colour at once, instead of stopping at the first.
        const invalid = themes.flatMap(theme =>
            Object.entries(theme.colors)
                .filter(([, value]) => !HEX_COLOR.test(value))
                .map(([key, value]) => `${theme.name}.${key} = ${value}`)
        );

        expect(invalid).toEqual([]);
    });
});

describe('DEFAULT_THEME', () => {
    // theme.ts resolves this with `themes.find(...) as Theme`. The cast means
    // renaming or removing the matched theme yields `undefined` at runtime
    // with no compile error, so it has to be asserted here instead.
    test('resolves to an actual theme', () => {
        expect(DEFAULT_THEME).toBeDefined();
        expect(DEFAULT_THEME).not.toBeUndefined();
    });

    test('is one of the themes in the list', () => {
        expect(themes).toContain(DEFAULT_THEME);
    });

    test('has a usable set of colours', () => {
        for (const key of REQUIRED_COLOR_KEYS) {
            expect(DEFAULT_THEME.colors[key]).toMatch(HEX_COLOR);
        }
    });
});
