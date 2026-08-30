import { describe, test, expect } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { useKeyboard } from '@opentui/react';
import { ModelPicker } from '../../src/components/model-picker';
import { useModel, ModelProvider } from '../../src/providers/model';
import { ThemeProvider } from '../../src/providers/theme';
import { useOverlay, OverlayProvider } from '../../src/providers/overlay';
import { KeyboardProvider, useLayerStack } from '../../src/providers/keyboard';
import { createLayerStack, ROOT_LAYER } from '../../src/keyboard';
import { DEFAULT_CHAT_MODEL_ID, findSupportedChatModel, SUPPORTED_CHAT_MODELS } from '@codeyantram/shared';
import { NO_BUILTIN_CTRL_C, tick } from '../support/mount';

const DEFAULT_MODEL = findSupportedChatModel(DEFAULT_CHAT_MODEL_ID)!;

// "m" opens the real overlay with a real ModelPicker inside it, and a
// persisting `current:<id>` label outside the overlay makes the actual
// active model observable both during and after the picker is used — same
// end-to-end shape as theme-picker.test.tsx's Harness.
//
// Guarded by isOnTop(ROOT_LAYER) for the same reason every other useKeyboard
// handler in this app is: it fires on every keypress regardless of who owns
// the keyboard, and would otherwise re-open the overlay from a query
// character that happens to be "m".
function Harness() {
    const { model } = useModel();
    const overlay = useOverlay();
    const layers = useLayerStack();

    useKeyboard(key => {
        if (key.name !== 'm') return;
        if (!layers.isOnTop(ROOT_LAYER)) return;
        overlay.show('Models', <ModelPicker />);
    });

    return <text>current:{model.id}</text>;
}

function mount(width = 60, height = 30) {
    const layers = createLayerStack();

    return testRender(
        <KeyboardProvider layers={layers}>
            <ThemeProvider>
                <ModelProvider>
                    <OverlayProvider>
                        <Harness />
                    </OverlayProvider>
                </ModelProvider>
            </ThemeProvider>
        </KeyboardProvider>,
        { width, height, ...NO_BUILTIN_CTRL_C }
    ).then(setup => ({ ...setup, layers }));
}

describe('rendering', () => {
    test('shows the initially visible models, with more scrollable below', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('m');
        // OverlayList's default maxVisible (6) means not all 7 catalog
        // models fit on screen at once — this checks the visible window
        // plus the scroll indicator, not that every model renders at once.
        const frame = await rendered.waitForFrame(f => f.includes('Models'));

        expect(frame).toContain(DEFAULT_MODEL.id);
        expect(frame).toContain('▼');
        rendered.renderer.destroy();
    });

    test('every model is reachable, including ones scrolled off-screen', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('m');
        await rendered.waitForFrame(f => f.includes('Models'));

        // "gemini-3.5-flash" is last in the catalog — not part of the
        // initially visible window — so reaching it via search is what
        // actually proves the full catalog made it into the picker.
        const last = SUPPORTED_CHAT_MODELS[SUPPORTED_CHAT_MODELS.length - 1]!;
        await rendered.mockInput.typeText(last.id, 15);
        const frame = await rendered.waitForFrame(f => f.includes(last.id));

        expect(frame).toContain(last.id);
        rendered.renderer.destroy();
    });

    test('marks the current model as active', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('m');
        const frame = await rendered.waitForFrame(f => f.includes('Models'));

        expect(frame).toContain(`● ${DEFAULT_MODEL.id}`);
        rendered.renderer.destroy();
    });
});

describe('filtering', () => {
    // Filtering goes through OverlayList's own query state, not something
    // waitForFrame can reliably poll for here — same scheduler-idle race
    // documented in input-bar.test.tsx and overlay.test.tsx for
    // React-state-driven updates. A tick to let it flush, then one forced
    // render pass, sidesteps it.
    test('narrows the list to matching model ids', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('m');
        await rendered.waitForFrame(f => f.includes('Models'));

        // "claude-h" matches exactly one model by id prefix, case-insensitively.
        await rendered.mockInput.typeText('claude-h', 15);
        await tick(50);
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        expect(frame).toContain('claude-haiku-4-5');
        for (const m of SUPPORTED_CHAT_MODELS) {
            // Excludes the still-active model too: nothing has been
            // selected yet in this test, so the persisting `current:<id>`
            // label outside the overlay legitimately still shows it,
            // regardless of what the list is filtered to.
            if (m.id === 'claude-haiku-4-5' || m.id === DEFAULT_MODEL.id) continue;
            expect(frame).not.toContain(m.id);
        }
        rendered.renderer.destroy();
    });

    test('shows "No models found" when the search matches nothing', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('m');
        await rendered.waitForFrame(f => f.includes('Models'));

        await rendered.mockInput.typeText('zzz', 15);
        await tick(50);
        await rendered.renderOnce();

        expect(rendered.captureCharFrame()).toContain('No models found');
        rendered.renderer.destroy();
    });
});

describe('selecting a model', () => {
    test('changes the active model and closes the overlay', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));
        expect(rendered.captureCharFrame()).toContain(`current:${DEFAULT_MODEL.id}`);

        rendered.mockInput.pressKey('m');
        await rendered.waitForFrame(f => f.includes('Models'));

        // "claude-o" matches only "claude-opus-5" by prefix.
        await rendered.mockInput.typeText('claude-o', 15);
        await tick(50);
        await rendered.renderOnce();
        expect(rendered.captureCharFrame()).toContain('claude-opus-5');

        rendered.mockInput.pressEnter();
        await tick(50);
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        expect(frame).not.toContain('Models');
        expect(frame).toContain('current:claude-opus-5');
        rendered.renderer.destroy();
    });
});
