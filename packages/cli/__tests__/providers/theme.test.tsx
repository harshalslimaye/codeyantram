import { describe, test, expect } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { useKeyboard } from '@opentui/react';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { useTheme, ThemeProvider, getInitialTheme } from '../../src/providers/theme';
import { DEFAULT_THEME } from '../../src/theme';

function ShowTheme() {
    const { currentTheme, colors } = useTheme();
    return <text>{currentTheme.name}:{colors.accent}</text>;
}

describe('useTheme', () => {
    test('throws when used outside a ThemeProvider', async () => {
        // @opentui/react wraps the tree in an ErrorBoundary, so the thrown
        // error surfaces as rendered text rather than an uncaught exception.
        const rendered = await testRender(<ShowTheme />, { width: 60, height: 20 });
        const frame = await rendered.waitForFrame(f => f.includes('ThemeProvider'));

        expect(frame).toContain('useTheme must be used within a ThemeProvider');
        rendered.renderer.destroy();
    });

    test('supplies the default theme inside a ThemeProvider', async () => {
        const rendered = await testRender(
            <ThemeProvider>
                <ShowTheme />
            </ThemeProvider>,
            { width: 60, height: 20 }
        );
        const frame = await rendered.waitForFrame(f => f.includes(DEFAULT_THEME.name));

        expect(frame).toContain(DEFAULT_THEME.name);
        expect(frame).toContain(DEFAULT_THEME.colors.accent);
        rendered.renderer.destroy();
    });
});

describe('ThemeProvider', () => {
    function SetThemeHarness() {
        const { currentTheme, setTheme } = useTheme();
        useKeyboard(key => {
            if (key.name === 's') setTheme({ ...currentTheme, name: 'Changed' });
        });
        return <text>{currentTheme.name}</text>;
    }

    test('setTheme changes the active theme', async () => {
        const rendered = await testRender(
            <ThemeProvider>
                <SetThemeHarness />
            </ThemeProvider>,
            { width: 60, height: 20 }
        );
        await rendered.waitForFrame(f => f.includes(DEFAULT_THEME.name));

        rendered.mockInput.pressKey('s');
        const frame = await rendered.waitForFrame(f => f.includes('Changed'));

        expect(frame).toContain('Changed');
        expect(frame).not.toContain(DEFAULT_THEME.name);
        rendered.renderer.destroy();
    });
});

describe('test-environment guard', () => {
    // getInitialTheme/persistTheme read and write ~/.codeyantram for real in
    // production. Bun sets NODE_ENV=test automatically, which both check —
    // without that, every test mounting ThemeProvider would depend on
    // whatever theme happens to be saved on the machine running them, and
    // every setTheme call above would write to it for real.
    test('getInitialTheme returns the default rather than reading the real file', () => {
        expect(getInitialTheme()).toBe(DEFAULT_THEME);
    });

    test('setTheme does not touch the real preferences file', async () => {
        // Checked as "unchanged from before this test", not "absent" — the
        // developer running this suite may have genuinely used the real app
        // and saved a theme already, and that pre-existing file is not this
        // test's business to disturb or assume away.
        const preferencesPath = join(homedir(), '.codeyantram', 'preferences.json');
        const existedBefore = existsSync(preferencesPath);
        const contentBefore = existedBefore ? readFileSync(preferencesPath, 'utf-8') : null;

        function SetThemeHarness() {
            const { currentTheme, setTheme } = useTheme();
            useKeyboard(key => {
                if (key.name === 's') setTheme({ ...currentTheme, name: 'Changed' });
            });
            return <text>{currentTheme.name}</text>;
        }

        const rendered = await testRender(
            <ThemeProvider>
                <SetThemeHarness />
            </ThemeProvider>,
            { width: 60, height: 20 }
        );
        await rendered.waitForFrame(f => f.includes(DEFAULT_THEME.name));

        rendered.mockInput.pressKey('s');
        await rendered.waitForFrame(f => f.includes('Changed'));

        expect(existsSync(preferencesPath)).toBe(existedBefore);
        if (existedBefore) {
            expect(readFileSync(preferencesPath, 'utf-8')).toBe(contentBefore!);
        }
        rendered.renderer.destroy();
    });
});
