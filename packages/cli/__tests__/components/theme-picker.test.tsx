import { describe, test, expect } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { useKeyboard } from '@opentui/react';
import { ThemePicker } from '../../src/components/theme-picker';
import { useTheme, ThemeProvider } from '../../src/providers/theme';
import { useOverlay, OverlayProvider } from '../../src/providers/overlay';
import { KeyboardProvider, useLayerStack } from '../../src/providers/keyboard';
import { createLayerStack, ROOT_LAYER } from '../../src/keyboard';
import { DEFAULT_THEME, themes } from '../../src/theme';
import { NO_BUILTIN_CTRL_C, tick } from '../support/mount';

// "t" opens the real overlay with a real ThemePicker inside it, and a
// persisting `current:<name>` label outside the overlay makes the actual
// active theme observable both during and after the picker is used — this
// is what makes the tests below end-to-end rather than a ThemePicker unit
// test with everything else stubbed out.
//
// Guarded by isOnTop(ROOT_LAYER) for the same reason every other useKeyboard
// handler in this app is: it fires on every keypress regardless of who owns
// the keyboard. Without the guard, typing a query that happens to contain
// "t" (e.g. "th" for "Thirai") re-triggers this handler on its own first
// character, re-opening the overlay from scratch mid-search — which is
// exactly what happened before this guard was added here.
function Harness() {
    const { currentTheme } = useTheme();
    const overlay = useOverlay();
    const layers = useLayerStack();

    useKeyboard(key => {
        if (key.name !== 't') return;
        if (!layers.isOnTop(ROOT_LAYER)) return;
        overlay.show('Themes', <ThemePicker />);
    });

    return <text>current:{currentTheme.name}</text>;
}

function mount(width = 60, height = 30) {
    const layers = createLayerStack();

    return testRender(
        <KeyboardProvider layers={layers}>
            <ThemeProvider>
                <OverlayProvider>
                    <Harness />
                </OverlayProvider>
            </ThemeProvider>
        </KeyboardProvider>,
        { width, height, ...NO_BUILTIN_CTRL_C }
    ).then(setup => ({ ...setup, layers }));
}

describe('rendering', () => {
    test('shows the initially visible themes, with more scrollable below', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('t');
        // OverlayList's default maxVisible (6) means not all 12 themes fit
        // on screen at once — this checks the visible window plus the
        // scroll indicator, not that every theme renders simultaneously.
        const frame = await rendered.waitForFrame(f => f.includes('Themes'));

        expect(frame).toContain(DEFAULT_THEME.name);
        expect(frame).toContain('▼');
        rendered.renderer.destroy();
    });

    test('every theme is reachable, including ones scrolled off-screen', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('t');
        await rendered.waitForFrame(f => f.includes('Themes'));

        // "Kaadu" is last in the list — not part of the initially visible
        // window — so reaching it via search is what actually proves the
        // full `themes` array made it into the picker, not just the first
        // few rows a fixed-height list happens to show.
        await rendered.mockInput.typeText('kaadu', 15);
        const frame = await rendered.waitForFrame(f => f.includes('Kaadu'));

        expect(frame).toContain('Kaadu');
        rendered.renderer.destroy();
    });

    test('marks the current theme as active', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('t');
        const frame = await rendered.waitForFrame(f => f.includes('Themes'));

        expect(frame).toContain(`● ${DEFAULT_THEME.name}`);
        rendered.renderer.destroy();
    });
});

describe('filtering', () => {
    // Filtering goes through OverlayList's own query state, not something
    // waitForFrame can reliably poll for here — the same scheduler-idle
    // race documented in input-bar.test.tsx and overlay.test.tsx for
    // React-state-driven updates. A tick to let it flush, then one forced
    // render pass, sidesteps it.
    test('narrows the list to matching theme names', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('t');
        await rendered.waitForFrame(f => f.includes('Themes'));

        // "Th" matches exactly one theme ("Thirai") by prefix, case-insensitively.
        await rendered.mockInput.typeText('th', 15);
        await tick(50);
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        expect(frame).toContain('Thirai');
        for (const theme of themes) {
            // Excludes the still-active theme too: nothing has been
            // selected yet in this test, so the persisting `current:<name>`
            // label outside the overlay legitimately still shows it,
            // regardless of what the list is filtered to.
            if (theme.name === 'Thirai' || theme.name === DEFAULT_THEME.name) continue;
            expect(frame).not.toContain(theme.name);
        }
        rendered.renderer.destroy();
    });

    test('shows "No Themes found" when the search matches nothing', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('t');
        await rendered.waitForFrame(f => f.includes('Themes'));

        await rendered.mockInput.typeText('zzz', 15);
        await tick(50);
        await rendered.renderOnce();

        expect(rendered.captureCharFrame()).toContain('No Themes found');
        rendered.renderer.destroy();
    });
});

describe('selecting a theme', () => {
    test('changes the active theme and closes the overlay', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));
        expect(rendered.captureCharFrame()).toContain(`current:${DEFAULT_THEME.name}`);

        rendered.mockInput.pressKey('t');
        await rendered.waitForFrame(f => f.includes('Themes'));

        await rendered.mockInput.typeText('th', 15);
        await tick(50);
        await rendered.renderOnce();
        expect(rendered.captureCharFrame()).toContain('Thirai');

        rendered.mockInput.pressEnter();
        await tick(50);
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        expect(frame).not.toContain('Themes');
        expect(frame).toContain('current:Thirai');
        rendered.renderer.destroy();
    });
});
