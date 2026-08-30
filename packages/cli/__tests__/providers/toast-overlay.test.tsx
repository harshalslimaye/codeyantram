import { describe, test, expect } from 'bun:test';
import { useKeyboard } from '@opentui/react';
import { testRender } from '@opentui/react/test-utils';
import { useOverlay, OverlayProvider } from '../../src/providers/overlay';
import { useToast, ToastProvider } from '../../src/providers/toast';
import { ThemeProvider } from '../../src/providers/theme';
import { KeyboardProvider } from '../../src/providers/keyboard';
import { createLayerStack } from '../../src/keyboard';
import { NO_BUILTIN_CTRL_C, settleEscape } from '../support/mount';

// Overlay content that reads useToast() itself — proving overlay content can
// reach it, which only holds because ToastProvider sits above OverlayProvider
// in the tree (see layouts/root.tsx).
function OverlayBody() {
    const toast = useToast();

    useKeyboard(key => {
        if (key.name === 't') toast.info('toast from inside overlay', { duration: 10_000 });
    });

    return <text>overlay body</text>;
}

// "o" opens the overlay with `OverlayBody` as its content, "i" fires a toast
// from outside the overlay.
function Harness() {
    const overlay = useOverlay();
    const toast = useToast();

    useKeyboard(key => {
        if (key.name === 'o') overlay.show('Test', <OverlayBody />);
        if (key.name === 'i') toast.info('toast from outside overlay', { duration: 10_000 });
    });

    return <text>ready</text>;
}

// Mirrors the real provider nesting in layouts/root.tsx exactly, rather than
// reusing support/mount.tsx's harnesses — this suite is specifically about
// how ToastProvider and OverlayProvider interact, so the nesting itself is
// the thing under test.
function mount(width = 60, height = 20) {
    const layers = createLayerStack();

    return testRender(
        <KeyboardProvider layers={layers}>
            <ThemeProvider>
                <ToastProvider>
                    <OverlayProvider>
                        <Harness />
                    </OverlayProvider>
                </ToastProvider>
            </ThemeProvider>
        </KeyboardProvider>,
        { width, height, ...NO_BUILTIN_CTRL_C }
    ).then(setup => ({ ...setup, layers }));
}

describe('toast + overlay coexistence', () => {
    test('a toast fired while the overlay is open stays visible above it', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('o');
        await rendered.waitForFrame(f => f.includes('overlay body'));

        rendered.mockInput.pressKey('i');
        const frame = await rendered.waitForFrame(f => f.includes('toast from outside overlay'));

        // Both must be in the same frame: the overlay's dimming backdrop is
        // an opaque full-screen box at zIndex 100, so this only holds if
        // ToastStack (zIndex 200) actually paints above it.
        expect(frame).toContain('overlay body');
        expect(frame).toContain('toast from outside overlay');
        rendered.renderer.destroy();
    });

    test('overlay content can fire toasts via useToast()', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('o');
        await rendered.waitForFrame(f => f.includes('overlay body'));

        rendered.mockInput.pressKey('t');
        const frame = await rendered.waitForFrame(f => f.includes('toast from inside overlay'));

        expect(frame).toContain('toast from inside overlay');
        rendered.renderer.destroy();
    });

    test('a live toast does not block escape from closing the overlay', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('o');
        await rendered.waitForFrame(f => f.includes('overlay body'));

        rendered.mockInput.pressKey('i');
        await rendered.waitForFrame(f => f.includes('toast from outside overlay'));

        rendered.mockInput.pressEscape();
        await settleEscape();
        const frame = await rendered.waitForFrame(f => !f.includes('overlay body'));

        // The overlay closed; the still-live toast is untouched — it never
        // claimed the keyboard layer, so it has no say in what escape does,
        // and closing the overlay has no effect on its own lifecycle.
        expect(frame).not.toContain('overlay body');
        expect(frame).toContain('toast from outside overlay');
        rendered.renderer.destroy();
    });
});
