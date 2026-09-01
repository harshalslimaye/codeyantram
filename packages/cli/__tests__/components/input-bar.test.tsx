import { describe, test, expect, spyOn } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { DEFAULT_CHAT_MODEL_ID, findSupportedChatModel } from '@codeyantram/shared';
import { InputBar } from '../../src/components/input-bar';
import { ThemeProvider } from '../../src/providers/theme';
import { ModelProvider } from '../../src/providers/model';
import { EffortProvider } from '../../src/providers/effort';
import { AgentProvider } from '../../src/providers/agent';
import { KeyboardProvider } from '../../src/providers/keyboard';
import { OverlayProvider } from '../../src/providers/overlay';
import { ToastProvider } from '../../src/providers/toast';
import { ChatProvider } from '../../src/providers/chat';
import { createLayerStack } from '../../src/keyboard';
import { DEFAULT_AGENT } from '../../src/agents';
import { NO_BUILTIN_CTRL_C, tick, settleEscape } from '../support/mount';

const DEFAULT_MODEL = findSupportedChatModel(DEFAULT_CHAT_MODEL_ID)!;
// The catalog guarantees a model with any supportedEffortLevels also has a
// defaultEffortLevel (see models.test.ts), but the union type can't express
// that here.
const DEFAULT_EFFORT = "defaultEffortLevel" in DEFAULT_MODEL ? DEFAULT_MODEL.defaultEffortLevel : undefined;

// Mirrors how Root and Home actually wrap InputBar: a KeyboardProvider for
// the layer stack InputBar now claims/reads, a ModelProvider and
// AgentProvider since InputBar reads the active model and agent for its
// footer, an EffortProvider since ChatProvider reads it to build a request,
// a ToastProvider and OverlayProvider since InputBar renders
// CommandMenu which now reads both (its `/themes`, `/models`, and `/agents`
// commands each open an overlay), a ChatProvider since InputBar now sends
// through it on Enter and reads isStreaming, and headroom above so the
// command menu's "position: absolute; bottom: 100%" dropup has room to
// render into. See autocomplete.test.tsx for why each test mounts fresh and
// performs one interaction arc ending in a single wait. Hands back the layer
// stack so a test can assert on ownership.
function mount(props?: { placeholder?: string }) {
    const layers = createLayerStack();

    return testRender(
        <KeyboardProvider layers={layers}>
            <ThemeProvider>
                <ModelProvider>
                    <EffortProvider>
                        <AgentProvider>
                            <ToastProvider>
                                <ChatProvider>
                                    <OverlayProvider>
                                        <box paddingTop={15} width={40}>
                                            <InputBar {...props} />
                                        </box>
                                    </OverlayProvider>
                                </ChatProvider>
                            </ToastProvider>
                        </AgentProvider>
                    </EffortProvider>
                </ModelProvider>
            </ThemeProvider>
        </KeyboardProvider>,
        { width: 40, height: 30, ...NO_BUILTIN_CTRL_C }
    ).then(setup => ({ ...setup, layers }));
}

describe('rendering', () => {
    test('shows the default placeholder', async () => {
        const rendered = await mount();
        const frame = await rendered.waitForFrame(f => f.includes('ask anything'));

        expect(frame).toContain('ask anything');
        rendered.renderer.destroy();
    });

    test('shows a custom placeholder when provided', async () => {
        const rendered = await mount({ placeholder: 'type here' });
        const frame = await rendered.waitForFrame(f => f.includes('type here'));

        expect(frame).toContain('type here');
        expect(frame).not.toContain('ask anything');
        rendered.renderer.destroy();
    });

    test('renders the agent, model, and send chrome', async () => {
        const rendered = await mount();
        const frame = await rendered.waitForFrame(f => f.includes(DEFAULT_MODEL.id));

        expect(frame).toContain(DEFAULT_AGENT.name);
        expect(frame).toContain(DEFAULT_MODEL.id);
        expect(frame).toContain('send');
        rendered.renderer.destroy();
    });

    test("shows the default model's effort level next to it", async () => {
        // claude-sonnet-5's defaultEffortLevel ("high") is what EffortProvider
        // resolves to with nothing persisted (preferences no-op under NODE_ENV=test).
        const rendered = await mount();
        const frame = await rendered.waitForFrame(f => f.includes(DEFAULT_MODEL.id));

        expect(frame).toContain(String(DEFAULT_EFFORT));
        rendered.renderer.destroy();
    });
});

describe('typing', () => {
    // The input is `focused` unconditionally on mount, so every test here
    // typing immediately after mount and having it register is itself the
    // coverage for "the input is focused on mount" — there is no separate
    // state to assert.

    test('typing updates the displayed value', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));

        await rendered.mockInput.typeText('hello', 15);
        const frame = await rendered.waitForFrame(f => f.includes('hello'));

        expect(frame).toContain('hello');
        rendered.renderer.destroy();
    });

    test('typing a trigger opens the command menu', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));

        await rendered.mockInput.typeText('/mo', 15);
        const frame = await rendered.waitForFrame(f => f.includes('models'));

        expect(frame).toContain('models');
        rendered.renderer.destroy();
    });
});

describe('end to end', () => {
    // No current command uses the `populate` (fill-in-full-text) action —
    // every command besides 'exit'/'themes'/'models'/'agents' shows a toast
    // instead (see commands.test.ts) — so the meaningful end-to-end path
    // through a real command is 'exit': typing it and pressing Enter should
    // reach the renderer's real exit path.
    test('typing /exit and pressing enter reaches the exit path', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));

        // Swallow the real destroy so the test harness itself survives —
        // we only care that it was *asked* to destroy.
        const destroySpy = spyOn(rendered.renderer, 'destroy').mockImplementation(() => {});

        await rendered.mockInput.typeText('/exit', 15);
        await rendered.waitForFrame(f => f.includes('exit'));
        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => destroySpy.mock.calls.length > 0);

        expect(destroySpy).toHaveBeenCalledTimes(1);
        destroySpy.mockRestore();
    });
});

describe('ctrl+c', () => {
    // Clearing goes through InputBar's own state, not the text visibly
    // typed by mockInput, so `waitFor`'s scheduler-idle check can observe a
    // moment between the keypress and React's state flush where nothing is
    // scheduled yet and give up early — the same class of race documented
    // for escape above, just on a state update instead of a timer. A tick to
    // let that flush happen, then one forced render pass, sidesteps it.
    test('clears the input when there is text', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));

        await rendered.mockInput.typeText('hello', 15);
        await rendered.waitForFrame(f => f.includes('hello'));

        rendered.mockInput.pressCtrlC();
        await tick(50);
        await rendered.renderOnce();

        expect(rendered.captureCharFrame()).not.toContain('hello');
        rendered.renderer.destroy();
    });

    test('quits once the input is already empty', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));

        // Swallow the real destroy so the test harness itself survives —
        // we only care that it was *asked* to destroy.
        const destroySpy = spyOn(rendered.renderer, 'destroy').mockImplementation(() => {});

        rendered.mockInput.pressCtrlC();
        await tick(50);

        expect(destroySpy).toHaveBeenCalledTimes(1);
        destroySpy.mockRestore();
    });

    test('closes the open command menu instead of touching the input', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));

        await rendered.mockInput.typeText('/mo', 15);
        await rendered.waitForFrame(f => f.includes('models'));

        // The menu owns the keyboard here, so this should close it — not
        // clear the text underneath, and not quit.
        rendered.mockInput.pressCtrlC();
        await tick(50);
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        expect(frame).not.toContain('models');
        expect(frame).toContain('/mo');
        rendered.renderer.destroy();
    });
});

describe('escape', () => {
    test('clears the input when there is text', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));

        await rendered.mockInput.typeText('hello', 15);
        await rendered.waitForFrame(f => f.includes('hello'));

        rendered.mockInput.pressEscape();
        await tick(50);
        await rendered.renderOnce();

        expect(rendered.captureCharFrame()).not.toContain('hello');
        rendered.renderer.destroy();
    });

    test('closes the open command menu instead of touching the input', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));

        await rendered.mockInput.typeText('/mo', 15);
        await rendered.waitForFrame(f => f.includes('models'));

        rendered.mockInput.pressEscape();
        await settleEscape();
        await rendered.waitFor(() => !rendered.captureCharFrame().includes('models'));

        const frame = rendered.captureCharFrame();
        expect(frame).not.toContain('models');
        expect(frame).toContain('/mo');
        rendered.renderer.destroy();
    });
});
