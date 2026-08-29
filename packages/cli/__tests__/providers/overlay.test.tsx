import { describe, test, expect } from 'bun:test';
import { useState, type ReactNode } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { useKeyboard } from '@opentui/react';
import { useOverlay, OverlayProvider } from '../../src/providers/overlay';
import { ThemeProvider } from '../../src/providers/theme';
import { KeyboardProvider } from '../../src/providers/keyboard';
import { createLayerStack } from '../../src/keyboard';
import { NO_BUILTIN_CTRL_C, tick } from '../support/mount';

// "s" shows the overlay, "r" replaces its content with an incremented
// counter, "c" closes it — enough to drive `useOverlay()` from a test
// without depending on any real focused widget.
function Harness() {
    const overlay = useOverlay();
    const [count, setCount] = useState(0);

    useKeyboard(key => {
        if (key.name === 's') overlay.show('Test', <text>overlay body {count}</text>);
        if (key.name === 'r') {
            const next = count + 1;
            setCount(next);
            overlay.show('Test', <text>overlay body {next}</text>);
        }
        if (key.name === 'c') overlay.close();
    });

    return <text>ready</text>;
}

// A real focused input to blur/restore against — `Harness` above has
// nothing focusable, since none of its tests need it.
function FocusHarness() {
    const overlay = useOverlay();

    useKeyboard(key => {
        if (key.name === 's') overlay.show('Test', <text>overlay body</text>);
    });

    return <input focused value="" onInput={() => {}} />;
}

function mount(node: ReactNode = <Harness />, width = 60, height = 20) {
    const layers = createLayerStack();

    return testRender(
        <KeyboardProvider layers={layers}>
            <ThemeProvider>
                <OverlayProvider>
                    {node}
                </OverlayProvider>
            </ThemeProvider>
        </KeyboardProvider>,
        { width, height, ...NO_BUILTIN_CTRL_C }
    ).then(setup => ({ ...setup, layers }));
}

describe('useOverlay', () => {
    test('throws when used outside an OverlayProvider', async () => {
        function Bare() {
            useOverlay();
            return <text>never renders</text>;
        }

        // @opentui/react wraps the tree in an ErrorBoundary, so the thrown
        // error surfaces as rendered text rather than an uncaught exception.
        const rendered = await testRender(<Bare />, { width: 100, height: 20 });
        const frame = await rendered.waitForFrame(f => f.includes('OverlayProvider'));

        expect(frame).toContain('useOverlay must be used within an OverlayProvider');
        rendered.renderer.destroy();
    });
});

describe('show / close', () => {
    test('renders nothing until show is called', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        expect(rendered.captureCharFrame()).not.toContain('overlay body');
        rendered.renderer.destroy();
    });

    test('show renders the overlay with the given title and body', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('s');
        const frame = await rendered.waitForFrame(f => f.includes('overlay body'));

        expect(frame).toContain('Test');
        expect(frame).toContain('overlay body 0');
        rendered.renderer.destroy();
    });

    test('close removes it', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('s');
        await rendered.waitForFrame(f => f.includes('overlay body'));

        await tick(10);
        rendered.mockInput.pressKey('c');
        await rendered.waitForFrame(f => !f.includes('overlay body'));

        expect(rendered.captureCharFrame()).not.toContain('overlay body');
        rendered.renderer.destroy();
    });

    test('a second show replaces the content instead of stacking it', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('s');
        await rendered.waitForFrame(f => f.includes('overlay body 0'));

        await tick(10);
        rendered.mockInput.pressKey('r');
        const frame = await rendered.waitForFrame(f => f.includes('overlay body 1'));

        expect(frame).not.toContain('overlay body 0');
        rendered.renderer.destroy();
    });
});

describe('focus', () => {
    // The blur-on-show / focus-on-close handoff lives in `show`/`close`
    // themselves (see the comment on `OverlayProvider`), specifically so it
    // runs before the overlay's own content — e.g. `OverlayList`'s search
    // input — ever mounts and self-focuses. A version of this test that put
    // the same logic in an effect on `Overlay` looked identical on paper but
    // captured the content's own input instead of the one outside it, since
    // that effect runs after the content has already mounted and focused
    // itself. This test exists to keep that ordering pinned.
    test('blurs the previously focused element while shown, and restores it on close', async () => {
        const rendered = await mount(<FocusHarness />);
        await rendered.waitFor(() => rendered.renderer.currentFocusedRenderable !== null);

        const input = rendered.renderer.currentFocusedRenderable;

        rendered.mockInput.pressKey('s');
        await rendered.waitForFrame(f => f.includes('overlay body'));

        // opentui does not auto-focus new content, so once show() blurs the
        // input this should be null rather than shift to something inside
        // the overlay.
        expect(rendered.renderer.currentFocusedRenderable).not.toBe(input);

        rendered.mockInput.pressEscape();
        await tick(50);

        expect(rendered.renderer.currentFocusedRenderable).toBe(input);
        rendered.renderer.destroy();
    });
});
