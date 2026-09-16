import { describe, test, expect, mock } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { useKeyboard } from '@opentui/react';
import { SUPPORTED_PROVIDERS } from '@codeyantram/shared';
import { ConnectFlow, ConnectForm, ConnectProviderList } from '../../src/components/connect-flow';
import { ThemeProvider } from '../../src/providers/theme';
import { useOverlay, OverlayProvider } from '../../src/providers/overlay';
import { ToastProvider } from '../../src/providers/toast';
import { KeyboardProvider, useLayerStack } from '../../src/providers/keyboard';
import { createLayerStack, ROOT_LAYER } from '../../src/keyboard';
import { NO_BUILTIN_CTRL_C, tick } from '../support/mount';

// "c" opens the real overlay with a real ConnectFlow inside it — same
// end-to-end shape as model-picker.test.tsx's Harness. Auth storage is
// guarded off under NODE_ENV=test (see @codeyantram/shared's auth.ts), so
// every provider always starts "not set" here regardless of what's on disk.
//
// Guarded by isOnTop(ROOT_LAYER) for the same reason every other useKeyboard
// handler in this app is: it fires on every keypress regardless of who owns
// the keyboard, and would otherwise re-open the overlay from a query
// character that happens to be "c".
function Harness() {
    const overlay = useOverlay();
    const layers = useLayerStack();

    useKeyboard(key => {
        if (key.name !== 'c') return;
        if (!layers.isOnTop(ROOT_LAYER)) return;
        overlay.show('Connect', <ConnectFlow />);
    });

    return <text>ready</text>;
}

function mount(width = 60, height = 30) {
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

describe('rendering', () => {
    test('shows every provider, all unconfigured', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('c');
        const frame = await rendered.waitForFrame(f => f.includes('Connect'));

        expect(frame).toContain('Anthropic');
        expect(frame).toContain('OpenAI');
        expect(frame).toContain('Google');
        expect(frame.split('not set').length - 1).toBe(SUPPORTED_PROVIDERS.length);
        expect(frame).not.toContain('configured');
        rendered.renderer.destroy();
    });
});

describe('selecting a provider', () => {
    // Filtering/selection goes through OverlayList's own query state, not
    // something waitForFrame can reliably poll for — same scheduler-idle
    // race documented in model-picker.test.tsx and overlay.test.tsx.
    test('opens a key-entry form for that provider', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('c');
        await rendered.waitForFrame(f => f.includes('Connect'));

        await rendered.mockInput.typeText('anthro', 15);
        await tick(50);
        await rendered.renderOnce();
        expect(rendered.captureCharFrame()).toContain('Anthropic');

        rendered.mockInput.pressEnter();
        await tick(50);
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        expect(frame).toContain('Paste your API key');
        rendered.renderer.destroy();
    });
});

describe('submitting a key', () => {
    test('saves it, toasts, and closes the overlay', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('c');
        await rendered.waitForFrame(f => f.includes('Connect'));

        await rendered.mockInput.typeText('anthro', 15);
        await tick(50);
        await rendered.renderOnce();
        rendered.mockInput.pressEnter();
        await tick(50);
        await rendered.renderOnce();
        expect(rendered.captureCharFrame()).toContain('Paste your API key');

        await rendered.mockInput.typeText('sk-test-123', 15);
        await tick(50);
        await rendered.renderOnce();
        rendered.mockInput.pressEnter();
        await tick(50);
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        expect(frame).toContain('Anthropic key saved');
        expect(frame).not.toContain('Connect');
        rendered.renderer.destroy();
    });

    test('a blank submit on an unconfigured provider does nothing', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('c');
        await rendered.waitForFrame(f => f.includes('Connect'));

        await rendered.mockInput.typeText('anthro', 15);
        await tick(50);
        await rendered.renderOnce();
        rendered.mockInput.pressEnter();
        await tick(50);
        await rendered.renderOnce();
        expect(rendered.captureCharFrame()).toContain('Paste your API key');

        rendered.mockInput.pressEnter();
        await tick(50);
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        expect(frame).toContain('Connect');
        expect(frame).toContain('Paste your API key');
        expect(frame).not.toContain('saved');
        expect(frame).not.toContain('cleared');
        rendered.renderer.destroy();
    });
});

// ConnectForm only needs 'overlay' on top of the layer stack (real usage
// guarantees that by only ever mounting inside an open Overlay — see
// overlay-list.test.tsx for the same setup).
describe('ConnectForm', () => {
    function mountForm(props: Partial<Parameters<typeof ConnectForm>[0]> = {}) {
        const onSaved = mock(() => {});
        const layers = createLayerStack();
        layers.push('overlay');

        const setup = testRender(
            <KeyboardProvider layers={layers}>
                <ConnectForm provider="anthropic" isConfigured={true} onSaved={onSaved} {...props} />
            </KeyboardProvider>,
            { width: 60, height: 20, ...NO_BUILTIN_CTRL_C }
        );
        return setup.then(rendered => ({ ...rendered, onSaved }));
    }

    test('a blank submit on a configured provider does nothing', async () => {
        const rendered = await mountForm();
        await rendered.waitForFrame(f => f.includes('Anthropic'));

        rendered.mockInput.pressEnter();
        await tick(20);

        expect(rendered.onSaved).not.toHaveBeenCalled();
        rendered.renderer.destroy();
    });

    test('a non-blank submit saves the key', async () => {
        const rendered = await mountForm();
        await rendered.waitForFrame(f => f.includes('Anthropic'));

        await rendered.mockInput.typeText('sk-test-123', 15);
        await tick(50);
        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => rendered.onSaved.mock.calls.length > 0);

        expect(rendered.onSaved).toHaveBeenCalledWith('anthropic');
        rendered.renderer.destroy();
    });
});

// ConnectProviderList mounted directly with a seeded `configured` set, same
// reasoning as ConnectForm above: the ctrl+d clear action is only reachable
// for a configured provider, which the disk guard makes untestable
// end-to-end through ConnectFlow under NODE_ENV=test.
describe('ConnectProviderList', () => {
    function mountList(configured: Set<'anthropic' | 'openai' | 'google' | 'deepseek' | 'openrouter'> = new Set()) {
        const onSelect = mock((_provider: string) => {});
        const onClear = mock((_provider: string) => {});
        const layers = createLayerStack();
        layers.push('overlay');

        const setup = testRender(
            <KeyboardProvider layers={layers}>
                <ThemeProvider>
                    <ConnectProviderList configured={configured} onSelect={onSelect} onClear={onClear} />
                </ThemeProvider>
            </KeyboardProvider>,
            { width: 60, height: 20, ...NO_BUILTIN_CTRL_C }
        );
        return setup.then(rendered => ({ ...rendered, onSelect, onClear }));
    }

    test('shows the ctrl+d clear hint', async () => {
        const rendered = await mountList();
        const frame = await rendered.waitForFrame(f => f.includes('Anthropic'));

        expect(frame).toContain('ctrl+d clear');
        rendered.renderer.destroy();
    });

    test('ctrl+d on a configured provider calls onClear', async () => {
        const rendered = await mountList(new Set(['anthropic']));
        await rendered.waitForFrame(f => f.includes('Anthropic'));

        rendered.mockInput.pressKey('d', { ctrl: true });
        await rendered.waitFor(() => rendered.onClear.mock.calls.length > 0);

        expect(rendered.onClear).toHaveBeenCalledWith('anthropic');
        expect(rendered.onSelect).not.toHaveBeenCalled();
        rendered.renderer.destroy();
    });
});

describe('clearing a key', () => {
    // Unlike "configured", "unconfigured" is the guaranteed starting state
    // under the disk guard (see the Harness comment above), so this guard —
    // ConnectFlow.handleClear no-oping when the highlighted provider has no
    // key — is reachable end-to-end here, unlike the "clears it" case.
    test('ctrl+d on an unconfigured provider does nothing', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('c');
        await rendered.waitForFrame(f => f.includes('Connect'));

        rendered.mockInput.pressKey('d', { ctrl: true });
        await tick(20);
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        expect(frame).toContain('Connect');
        expect(frame).not.toContain('cleared');
        rendered.renderer.destroy();
    });
});
