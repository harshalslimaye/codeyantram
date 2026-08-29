import { describe, test, expect } from 'bun:test';
import { useState, type ReactNode } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { Overlay } from '../../src/components/overlay';
import { ThemeProvider } from '../../src/providers/theme';
import { KeyboardProvider } from '../../src/providers/keyboard';
import { createLayerStack } from '../../src/keyboard';
import { NO_BUILTIN_CTRL_C, tick } from '../support/mount';

// A togglable Overlay so tests can drive open/close the same way the real
// OverlayProvider does — by mounting and unmounting the component, not by an
// `open` prop. Note: this harness does not exercise focus handoff —
// `Overlay` deliberately isn't responsible for that (see overlay.tsx); that
// lives in, and is tested by, providers/overlay.test.tsx.
function Harness({ initialOpen = true }: { initialOpen?: boolean }) {
    const [open, setOpen] = useState(initialOpen);
    return (
        <box>
            <input focused value="" onInput={() => {}} />
            {open && (
                <Overlay title="Test" onClose={() => setOpen(false)}>
                    <text>overlay body</text>
                </Overlay>
            )}
        </box>
    );
}

function mount(node: ReactNode, options?: { width?: number; height?: number }) {
    const width = options?.width ?? 60;
    const height = options?.height ?? 20;
    const layers = createLayerStack();

    return testRender(
        <KeyboardProvider layers={layers}>
            <ThemeProvider>{node}</ThemeProvider>
        </KeyboardProvider>,
        { width, height, ...NO_BUILTIN_CTRL_C }
    ).then(setup => ({ ...setup, layers }));
}

describe('rendering', () => {
    test('shows the title and the esc hint', async () => {
        const rendered = await mount(<Harness />);
        const frame = await rendered.waitForFrame(f => f.includes('Test'));

        expect(frame).toContain('Test');
        expect(frame).toContain('esc');
        rendered.renderer.destroy();
    });

    test('renders children below the header', async () => {
        const rendered = await mount(<Harness />);
        const frame = await rendered.waitForFrame(f => f.includes('overlay body'));

        expect(frame).toContain('overlay body');
        rendered.renderer.destroy();
    });
});

describe('layer ownership', () => {
    test('claims the overlay layer while mounted', async () => {
        const rendered = await mount(<Harness />);
        await rendered.waitForFrame(f => f.includes('Test'));

        expect(rendered.layers.isOnTop('overlay')).toBe(true);
        rendered.renderer.destroy();
    });

    test('releases the overlay layer once closed', async () => {
        const rendered = await mount(<Harness />);
        await rendered.waitForFrame(f => f.includes('Test'));

        rendered.mockInput.pressEscape();
        await tick(50);

        expect(rendered.layers.isOnTop('root')).toBe(true);
        rendered.renderer.destroy();
    });

    test('stays silent while another layer is on top of it', async () => {
        const rendered = await mount(<Harness />);
        await rendered.waitForFrame(f => f.includes('Test'));

        // Not a real flow today (nothing currently opens on top of an open
        // overlay), but it's the same guard `autocomplete.tsx` relies on, so
        // it's worth pinning directly against the layer stack rather than
        // only through the one ordering the app happens to produce today.
        const release = rendered.layers.push('autocomplete');
        rendered.mockInput.pressEscape();
        await tick(50);

        expect(rendered.captureCharFrame()).toContain('overlay body');

        release();
        rendered.renderer.destroy();
    });
});

describe('dismissal', () => {
    // Closing goes through React state (Harness's `open`), not something
    // mockInput typed directly, so `waitFor`'s scheduler-idle check can
    // observe a moment between the keypress and React's state flush where
    // nothing looks scheduled yet and give up early — the same race
    // documented in input-bar.test.tsx's ctrl+c tests. A tick to let the
    // flush happen, then one forced render pass, sidesteps it.
    test('escape closes it', async () => {
        const rendered = await mount(<Harness />);
        await rendered.waitForFrame(f => f.includes('overlay body'));

        rendered.mockInput.pressEscape();
        await tick(50);
        await rendered.renderOnce();

        expect(rendered.captureCharFrame()).not.toContain('overlay body');
        rendered.renderer.destroy();
    });

    test('ctrl+c closes it', async () => {
        const rendered = await mount(<Harness />);
        await rendered.waitForFrame(f => f.includes('overlay body'));

        rendered.mockInput.pressCtrlC();
        await tick(50);
        await rendered.renderOnce();

        expect(rendered.captureCharFrame()).not.toContain('overlay body');
        rendered.renderer.destroy();
    });
});
