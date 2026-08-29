import { describe, test, expect } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { useKeyboard } from '@opentui/react';
import { useTheme, ThemeProvider } from '../../src/providers/theme';
import { DEFAULT_THEME } from '../../src/theme';
import { tick } from '../support/mount';

function ShowTheme() {
    const { theme, colors } = useTheme();
    return <text>{theme.name}:{colors.accent}</text>;
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
    // Pinned as a known-incomplete behavior, not a desired one: setTheme is
    // currently `() => {}`. If this is ever implemented for real, this test
    // should fail and get updated deliberately, rather than the no-op
    // silently starting to "work" (or not) with nobody noticing either way.
    function SetThemeHarness() {
        const { theme, setTheme } = useTheme();
        useKeyboard(key => {
            if (key.name === 's') setTheme({ ...theme, name: 'Changed' });
        });
        return <text>{theme.name}</text>;
    }

    test('setTheme does not currently change the active theme', async () => {
        const rendered = await testRender(
            <ThemeProvider>
                <SetThemeHarness />
            </ThemeProvider>,
            { width: 60, height: 20 }
        );
        await rendered.waitForFrame(f => f.includes(DEFAULT_THEME.name));

        rendered.mockInput.pressKey('s');
        await tick(50);

        const frame = rendered.captureCharFrame();
        expect(frame).toContain(DEFAULT_THEME.name);
        expect(frame).not.toContain('Changed');
        rendered.renderer.destroy();
    });
});
