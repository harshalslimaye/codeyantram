import { describe, test, expect } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { useKeyboard } from '@opentui/react';
import { EffortPicker } from '../../src/components/effort-picker';
import { useModel, ModelProvider } from '../../src/providers/model';
import { useEffort, EffortProvider } from '../../src/providers/effort';
import { ThemeProvider } from '../../src/providers/theme';
import { useOverlay, OverlayProvider } from '../../src/providers/overlay';
import { KeyboardProvider, useLayerStack } from '../../src/providers/keyboard';
import { createLayerStack, ROOT_LAYER } from '../../src/keyboard';
import { DEFAULT_CHAT_MODEL_ID, findSupportedChatModel, SUPPORTED_CHAT_MODELS } from '@codeyantram/shared';
import { NO_BUILTIN_CTRL_C, tick } from '../support/mount';

const DEFAULT_MODEL = findSupportedChatModel(DEFAULT_CHAT_MODEL_ID)!;
const DEFAULT_EFFORT = "defaultEffortLevel" in DEFAULT_MODEL ? DEFAULT_MODEL.defaultEffortLevel : undefined;
// claude-haiku-4-5 in the catalog: supportedEffortLevels is empty.
const NO_EFFORT_MODEL = SUPPORTED_CHAT_MODELS.find(m => m.supportedEffortLevels.length === 0)!;

// "e" opens the real overlay with a real EffortPicker inside it, and "n"
// switches to a model with no effort control, so tests can drive both the
// normal list and the "no adjustable effort" branch — same end-to-end shape
// as model-picker.test.tsx's Harness.
function Harness() {
    const { model, setModel } = useModel();
    const { effort } = useEffort();
    const overlay = useOverlay();
    const layers = useLayerStack();

    useKeyboard(key => {
        if (!layers.isOnTop(ROOT_LAYER)) return;
        if (key.name === 'e') overlay.show('Effort', <EffortPicker />);
        // A single key switches to the no-effort model and opens the
        // overlay in the same handler call - two separate bare keypresses in
        // one render is unreliable in this test harness (its render loop
        // goes idle between them and the second never gets delivered), so
        // both state changes happen together instead.
        if (key.name === 'x') {
            setModel(NO_EFFORT_MODEL);
            overlay.show('Effort', <EffortPicker />);
        }
    });

    return (
        <text>
            current:{model.id}:{effort ?? 'undefined'}
        </text>
    );
}

function mount(width = 60, height = 30) {
    const layers = createLayerStack();

    return testRender(
        <KeyboardProvider layers={layers}>
            <ThemeProvider>
                <ModelProvider>
                    <EffortProvider>
                        <OverlayProvider>
                            <Harness />
                        </OverlayProvider>
                    </EffortProvider>
                </ModelProvider>
            </ThemeProvider>
        </KeyboardProvider>,
        { width, height, ...NO_BUILTIN_CTRL_C }
    ).then(setup => ({ ...setup, layers }));
}

describe('rendering', () => {
    test('shows the supported effort levels for the current model', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('e');
        const frame = await rendered.waitForFrame(f => f.includes('Effort'));

        for (const level of DEFAULT_MODEL.supportedEffortLevels) {
            expect(frame).toContain(level);
        }
        rendered.renderer.destroy();
    });

    test('marks the current effort level as active', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('e');
        const frame = await rendered.waitForFrame(f => f.includes('Effort'));

        expect(frame).toContain(`● ${DEFAULT_EFFORT}`);
        rendered.renderer.destroy();
    });

    test('shows a fallback message instead of a list for a model with no effort control', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('x');
        const frame = await rendered.waitForFrame(f => f.includes('Effort'));

        expect(frame).toContain(NO_EFFORT_MODEL.id);
        expect(frame).toContain('no adjustable effort level');
        rendered.renderer.destroy();
    });
});

describe('selecting an effort level', () => {
    test('changes the active effort and closes the overlay', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));
        expect(rendered.captureCharFrame()).toContain(`current:${DEFAULT_MODEL.id}:${DEFAULT_EFFORT}`);

        rendered.mockInput.pressKey('e');
        await rendered.waitForFrame(f => f.includes('Effort'));

        // "low" matches exactly one entry by prefix.
        await rendered.mockInput.typeText('low', 15);
        await tick(50);
        await rendered.renderOnce();
        expect(rendered.captureCharFrame()).toContain('low');

        rendered.mockInput.pressEnter();
        await tick(50);
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        expect(frame).not.toContain('Effort');
        expect(frame).toContain(`current:${DEFAULT_MODEL.id}:low`);
        rendered.renderer.destroy();
    });
});
