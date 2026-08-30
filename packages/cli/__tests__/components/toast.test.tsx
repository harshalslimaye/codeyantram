import { describe, test, expect } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { ToastStack, type ToastData } from '../../src/components/toast';
import { ThemeProvider } from '../../src/providers/theme';
import { KeyboardProvider } from '../../src/providers/keyboard';
import { createLayerStack } from '../../src/keyboard';
import { NO_BUILTIN_CTRL_C } from '../support/mount';

function mount(toasts: ToastData[], options?: { width?: number; height?: number }) {
    const width = options?.width ?? 60;
    const height = options?.height ?? 20;
    const layers = createLayerStack();

    return testRender(
        <KeyboardProvider layers={layers}>
            <ThemeProvider>
                <ToastStack toasts={toasts} />
            </ThemeProvider>
        </KeyboardProvider>,
        { width, height, ...NO_BUILTIN_CTRL_C }
    );
}

describe('rendering', () => {
    test('renders nothing for an empty list', async () => {
        const rendered = await mount([]);
        // Nothing to wait for, so give the renderer a frame to settle.
        await rendered.waitForFrame(() => true);

        expect(rendered.captureCharFrame().trim()).toBe('');
        rendered.renderer.destroy();
    });

    test('renders an info toast with its message', async () => {
        const rendered = await mount([{ id: '1', variant: 'info', message: 'Saved' }]);
        const frame = await rendered.waitForFrame(f => f.includes('Saved'));

        expect(frame).toContain('Saved');
        rendered.renderer.destroy();
    });

    test('renders a warn toast with its message', async () => {
        const rendered = await mount([{ id: '1', variant: 'warn', message: 'Careful' }]);
        const frame = await rendered.waitForFrame(f => f.includes('Careful'));

        expect(frame).toContain('Careful');
        rendered.renderer.destroy();
    });

    test('renders an error toast with its message', async () => {
        const rendered = await mount([{ id: '1', variant: 'error', message: 'Failed' }]);
        const frame = await rendered.waitForFrame(f => f.includes('Failed'));

        expect(frame).toContain('Failed');
        rendered.renderer.destroy();
    });

    test('renders multiple stacked toasts together', async () => {
        const rendered = await mount([
            { id: '1', variant: 'info', message: 'First' },
            { id: '2', variant: 'warn', message: 'Second' },
            { id: '3', variant: 'error', message: 'Third' },
        ]);
        const frame = await rendered.waitForFrame(f => f.includes('Third'));

        expect(frame).toContain('First');
        expect(frame).toContain('Second');
        expect(frame).toContain('Third');
        rendered.renderer.destroy();
    });

    test('wraps a message longer than the toast width instead of truncating it', async () => {
        const message = 'This is a much longer toast message than the fixed toast width';
        const rendered = await mount([{ id: '1', variant: 'info', message }]);
        await rendered.waitForFrame(f => f.includes('This is a much longer'));

        const frame = rendered.captureCharFrame();
        for (const word of message.split(' ')) {
            expect(frame).toContain(word);
        }
        rendered.renderer.destroy();
    });
});
