import { describe, test, expect } from 'bun:test';
import { useRef, type ReactNode } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { useKeyboard } from '@opentui/react';
import { useToast, ToastProvider } from '../../src/providers/toast';
import { ThemeProvider } from '../../src/providers/theme';
import { KeyboardProvider } from '../../src/providers/keyboard';
import { createLayerStack } from '../../src/keyboard';
import { NO_BUILTIN_CTRL_C, tick } from '../support/mount';

// Short enough that tests can wait out a real auto-dismiss with `tick`
// instead of mocking timers.
const SHORT_DURATION = 30;

// "i"/"w"/"e" fire one toast of each variant with a short duration, "d"
// dismisses the most recently shown one, "m" fires many in a row (to drive
// the max-visible cap) — enough to exercise `useToast()` without depending
// on any real producer.
function Harness() {
    const toast = useToast();
    const lastId = useRef<string | null>(null);

    useKeyboard(key => {
        if (key.name === 'i') lastId.current = toast.info('info message', { duration: SHORT_DURATION });
        if (key.name === 'w') lastId.current = toast.warn('warn message', { duration: SHORT_DURATION });
        if (key.name === 'e') lastId.current = toast.error('error message', { duration: SHORT_DURATION });
        if (key.name === 'd' && lastId.current) toast.dismiss(lastId.current);
        if (key.name === 'm') {
            for (let i = 0; i < 4; i++) {
                toast.info(`bulk ${i}`, { duration: 10_000 });
            }
        }
    });

    return <text>ready</text>;
}

function mount(node: ReactNode = <Harness />, width = 60, height = 20) {
    const layers = createLayerStack();

    return testRender(
        <KeyboardProvider layers={layers}>
            <ThemeProvider>
                <ToastProvider>{node}</ToastProvider>
            </ThemeProvider>
        </KeyboardProvider>,
        { width, height, ...NO_BUILTIN_CTRL_C }
    ).then(setup => ({ ...setup, layers }));
}

describe('useToast', () => {
    test('throws when used outside a ToastProvider', async () => {
        function Bare() {
            useToast();
            return <text>never renders</text>;
        }

        // @opentui/react wraps the tree in an ErrorBoundary, so the thrown
        // error surfaces as rendered text rather than an uncaught exception.
        const rendered = await testRender(<Bare />, { width: 100, height: 20 });
        const frame = await rendered.waitForFrame(f => f.includes('ToastProvider'));

        expect(frame).toContain('useToast must be used within a ToastProvider');
        rendered.renderer.destroy();
    });
});

describe('info / warn / error', () => {
    test('renders nothing until a toast is shown', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        expect(rendered.captureCharFrame()).not.toContain('message');
        rendered.renderer.destroy();
    });

    test('info shows an info toast', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('i');
        const frame = await rendered.waitForFrame(f => f.includes('info message'));

        expect(frame).toContain('info message');
        rendered.renderer.destroy();
    });

    test('warn shows a warn toast', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('w');
        const frame = await rendered.waitForFrame(f => f.includes('warn message'));

        expect(frame).toContain('warn message');
        rendered.renderer.destroy();
    });

    test('error shows an error toast', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('e');
        const frame = await rendered.waitForFrame(f => f.includes('error message'));

        expect(frame).toContain('error message');
        rendered.renderer.destroy();
    });
});

describe('auto-dismiss', () => {
    test('a toast disappears on its own after its duration elapses', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('i');
        await rendered.waitForFrame(f => f.includes('info message'));

        await rendered.waitForFrame(f => !f.includes('info message'));
        expect(rendered.captureCharFrame()).not.toContain('info message');
        rendered.renderer.destroy();
    });
});

describe('dismiss', () => {
    test('removes the toast immediately and cancels its timer', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('i');
        await rendered.waitForFrame(f => f.includes('info message'));

        rendered.mockInput.pressKey('d');
        await rendered.waitForFrame(f => !f.includes('info message'));

        // Wait past the original duration too, to confirm the now-stale
        // timer doesn't do anything (e.g. throw trying to remove an id
        // that's already gone).
        await tick(SHORT_DURATION + 20);
        expect(rendered.captureCharFrame()).not.toContain('info message');
        rendered.renderer.destroy();
    });
});

describe('max visible cap', () => {
    test('keeps only the newest toasts once the cap is exceeded', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('m');
        const frame = await rendered.waitForFrame(f => f.includes('bulk 3'));

        expect(frame).not.toContain('bulk 0');
        expect(frame).toContain('bulk 1');
        expect(frame).toContain('bulk 2');
        expect(frame).toContain('bulk 3');
        rendered.renderer.destroy();
    });
});

describe('unmount', () => {
    test('does not update state after the provider unmounts', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('i');
        await rendered.waitForFrame(f => f.includes('info message'));

        // Destroying the renderer here (rather than after the timer would
        // have fired) is the point: a leftover timer calling setState on an
        // unmounted tree is exactly the bug this test guards against.
        rendered.renderer.destroy();
        await tick(SHORT_DURATION + 20);
    });
});
