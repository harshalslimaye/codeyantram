import { afterEach, describe, test, expect, spyOn } from 'bun:test';
import type { ReactNode } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { DEFAULT_CHAT_MODEL_ID, findSupportedChatModel } from '@codeyantram/shared';
import { InputBar } from '../../src/components/input-bar';
import { ThemeProvider } from '../../src/providers/theme';
import { ModelProvider } from '../../src/providers/model';
import { EffortProvider } from '../../src/providers/effort';
import { AgentProvider } from '../../src/providers/agent';
import { KeyboardProvider } from '../../src/providers/keyboard';
import { HistoryProvider, useHistory } from '../../src/providers/history';
import { OverlayProvider } from '../../src/providers/overlay';
import { ToastProvider } from '../../src/providers/toast';
import { ChatProvider, useChat } from '../../src/providers/chat';
import { createLayerStack } from '../../src/keyboard';
import { DEFAULT_AGENT } from '../../src/agents';
import { NO_BUILTIN_CTRL_C, tick, settleEscape } from '../support/mount';
import { mockFetch, sseResponse } from '../support/sse';

const DEFAULT_MODEL = findSupportedChatModel(DEFAULT_CHAT_MODEL_ID)!;
// The catalog guarantees a model with any supportedEffortLevels also has a
// defaultEffortLevel (see models.test.ts), but the union type can't express
// that here.
const DEFAULT_EFFORT = "defaultEffortLevel" in DEFAULT_MODEL ? DEFAULT_MODEL.defaultEffortLevel : undefined;

// Mirrors how Root and Home actually wrap InputBar: a KeyboardProvider for
// the layer stack InputBar now claims/reads, a HistoryProvider for the
// prompt history it records into and recalls from, a ModelProvider and
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
// `screen` swaps out the input itself, for the one test that needs the
// Home/Session remount rather than a single stable InputBar; `probe` adds a
// sibling that renders context state the input doesn't show yet.
function mount({ probe, screen, width = 40, ...props }: { placeholder?: string; probe?: ReactNode; screen?: ReactNode; width?: number } = {}) {
    const layers = createLayerStack();

    return testRender(
        <KeyboardProvider layers={layers}>
            <HistoryProvider>
                <ThemeProvider>
                    <ModelProvider>
                        <EffortProvider>
                            <AgentProvider>
                                <ToastProvider>
                                    <ChatProvider>
                                        <OverlayProvider>
                                            <box paddingTop={15} width={width}>
                                                {screen ?? <InputBar {...props} />}
                                                {probe}
                                            </box>
                                        </OverlayProvider>
                                    </ChatProvider>
                                </ToastProvider>
                            </AgentProvider>
                        </EffortProvider>
                    </ModelProvider>
                </ThemeProvider>
            </HistoryProvider>
        </KeyboardProvider>,
        { width, height: 30, ...NO_BUILTIN_CTRL_C }
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

// Nothing in the input renders history itself, so tests that need to see it
// mount this alongside.
function HistoryProbe() {
    const { entries, isBrowsing } = useHistory();
    return <text>history[{entries.join('|')}]browsing[{String(isBrowsing())}]</text>;
}

describe('prompt history', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    // Submitting goes through the real ChatProvider, which posts to the
    // server - answer with an SSE body that closes without a single event.
    // The turn ends silently (see streamChat: no `done`/`error` is a normal
    // cancellation), so nothing here has to model a response, and no error
    // toast lands on top of the frame being asserted.
    function stubServer() {
        mockFetch(() => Promise.resolve(sseResponse([])));
    }

    // Mirrors index.tsx's AppScreen: the first message swaps Home for
    // Session, and both screens render an InputBar of their own - a
    // different element in a different position, so React unmounts the first
    // one and mounts a second.
    function ScreenSwap() {
        const { messages } = useChat();
        if (messages.length === 0) return <InputBar />;

        return (
            <box>
                <text>session</text>
                <InputBar />
            </box>
        );
    }

    // A key handler's state update isn't in a frame until React flushes it,
    // and waitForFrame's scheduler-idle check can catch the gap between the
    // two (the same race documented for the clear-the-input tests below).
    async function settle(rendered: Awaited<ReturnType<typeof mount>>): Promise<string> {
        await tick(50);
        await rendered.renderOnce();
        return rendered.captureCharFrame();
    }

    test('records the submitted prompt', async () => {
        stubServer();
        const rendered = await mount({ probe: <HistoryProbe /> });
        await rendered.waitForFrame(f => f.includes('history[]'));

        await rendered.mockInput.typeText('hello', 15);
        rendered.mockInput.pressEnter();

        expect(await settle(rendered)).toContain('history[hello]');
        rendered.renderer.destroy();
    });

    test('records each prompt in submission order', async () => {
        stubServer();
        const rendered = await mount({ probe: <HistoryProbe /> });
        await rendered.waitForFrame(f => f.includes('history[]'));

        await rendered.mockInput.typeText('one', 15);
        rendered.mockInput.pressEnter();
        await settle(rendered);
        await rendered.mockInput.typeText('two', 15);
        rendered.mockInput.pressEnter();

        expect(await settle(rendered)).toContain('history[one|two]');
        rendered.renderer.destroy();
    });

    test('keeps the recorded prompt when the screen swap remounts the input', async () => {
        stubServer();
        const rendered = await mount({ probe: <HistoryProbe />, screen: <ScreenSwap /> });
        await rendered.waitForFrame(f => f.includes('history[]'));

        await rendered.mockInput.typeText('hello', 15);
        rendered.mockInput.pressEnter();
        const frame = await settle(rendered);

        // The whole reason history lives in a provider: the InputBar that
        // recorded this is gone by now.
        expect(frame).toContain('session');
        expect(frame).toContain('history[hello]');
        rendered.renderer.destroy();
    });

    test('clearing the prompt leaves the recorded history alone', async () => {
        stubServer();
        const rendered = await mount({ probe: <HistoryProbe /> });
        await rendered.waitForFrame(f => f.includes('history[]'));

        await rendered.mockInput.typeText('hello', 15);
        rendered.mockInput.pressEnter();
        await settle(rendered);

        await rendered.mockInput.typeText('half typed', 15);
        rendered.mockInput.pressEscape();
        const frame = await settle(rendered);

        expect(frame).toContain('history[hello]');
        expect(frame).toContain('browsing[false]');
        rendered.renderer.destroy();
    });
});

describe('history navigation', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    // See the prompt-history block above for why the server is stubbed and
    // why assertions go through settle() rather than waitForFrame.
    function stubServer() {
        mockFetch(() => Promise.resolve(sseResponse([])));
    }

    async function settle(rendered: Awaited<ReturnType<typeof mount>>): Promise<string> {
        await tick(50);
        await rendered.renderOnce();
        return rendered.captureCharFrame();
    }

    /** Types and submits each prompt, leaving them in history newest-last. */
    async function submitAll(rendered: Awaited<ReturnType<typeof mount>>, ...prompts: string[]) {
        for (const prompt of prompts) {
            await rendered.mockInput.typeText(prompt, 15);
            rendered.mockInput.pressEnter();
            await settle(rendered);
        }
    }

    // Nothing but the input itself renders these prompts in this mount (no
    // MessageList here), so finding one in the frame means it is in the
    // input.
    test('up recalls the newest prompt', async () => {
        stubServer();
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));
        await submitAll(rendered, 'alpha', 'beta');

        rendered.mockInput.pressArrow('up');
        const frame = await settle(rendered);

        expect(frame).toContain('beta');
        rendered.renderer.destroy();
    });

    test('up again steps to the prompt before it', async () => {
        stubServer();
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));
        await submitAll(rendered, 'alpha', 'beta');

        rendered.mockInput.pressArrow('up');
        await settle(rendered);
        rendered.mockInput.pressArrow('up');
        const frame = await settle(rendered);

        expect(frame).toContain('alpha');
        expect(frame).not.toContain('beta');
        rendered.renderer.destroy();
    });

    test('stays on the oldest prompt rather than wrapping', async () => {
        stubServer();
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));
        await submitAll(rendered, 'alpha', 'beta');

        rendered.mockInput.pressArrow('up');
        rendered.mockInput.pressArrow('up');
        await settle(rendered);
        rendered.mockInput.pressArrow('up');
        const frame = await settle(rendered);

        expect(frame).toContain('alpha');
        rendered.renderer.destroy();
    });

    test('down steps back toward the newest prompt', async () => {
        stubServer();
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));
        await submitAll(rendered, 'alpha', 'beta');

        rendered.mockInput.pressArrow('up');
        rendered.mockInput.pressArrow('up');
        await settle(rendered);
        rendered.mockInput.pressArrow('down');
        const frame = await settle(rendered);

        expect(frame).toContain('beta');
        expect(frame).not.toContain('alpha');
        rendered.renderer.destroy();
    });

    test('down past the newest prompt restores the half-typed draft', async () => {
        stubServer();
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));
        await submitAll(rendered, 'alpha');

        await rendered.mockInput.typeText('unsent', 15);
        rendered.mockInput.pressArrow('up');
        expect(await settle(rendered)).toContain('alpha');

        rendered.mockInput.pressArrow('down');
        const frame = await settle(rendered);

        expect(frame).toContain('unsent');
        expect(frame).not.toContain('alpha');
        rendered.renderer.destroy();
    });

    test('editing a recalled prompt starts the next walk from the newest again', async () => {
        stubServer();
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));
        await submitAll(rendered, 'alpha', 'beta');

        rendered.mockInput.pressArrow('up');
        rendered.mockInput.pressArrow('up');
        expect(await settle(rendered)).toContain('alpha');

        // Typing makes this the user's own text again, so the walk restarts.
        await rendered.mockInput.typeText('!', 15);
        rendered.mockInput.pressArrow('up');
        const frame = await settle(rendered);

        expect(frame).toContain('beta');
        rendered.renderer.destroy();
    });

    test('moves the caret instead of recalling inside a multi-line prompt', async () => {
        stubServer();
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));
        await submitAll(rendered, 'alpha');

        // Pasted rather than typed with shift+enter: a terminal can't encode
        // that combination, and mockInput's shift+enter arrives as a plain
        // return, which this input binds to submit.
        await rendered.mockInput.pasteBracketedText('first\nsecond');
        await settle(rendered);

        // The caret is on the last row, so up belongs to the textarea.
        rendered.mockInput.pressArrow('up');
        const frame = await settle(rendered);

        expect(frame).toContain('first');
        expect(frame).toContain('second');
        expect(frame).not.toContain('alpha');
        rendered.renderer.destroy();
    });

    test('recalls once the caret reaches the top row of a multi-line prompt', async () => {
        stubServer();
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));
        await submitAll(rendered, 'alpha');

        await rendered.mockInput.pasteBracketedText('first\nsecond');
        await settle(rendered);

        // First press walks the caret up to the top row; only the second one
        // has an edge to step off.
        rendered.mockInput.pressArrow('up');
        await settle(rendered);
        rendered.mockInput.pressArrow('up');
        const frame = await settle(rendered);

        expect(frame).toContain('alpha');
        expect(frame).not.toContain('second');
        rendered.renderer.destroy();
    });

    test('leaves up to the command menu while it owns the keyboard', async () => {
        stubServer();
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));
        await submitAll(rendered, 'alpha');

        await rendered.mockInput.typeText('/mo', 15);
        await rendered.waitForFrame(f => f.includes('models'));

        rendered.mockInput.pressArrow('up');
        const frame = await settle(rendered);

        expect(frame).toContain('/mo');
        expect(frame).not.toContain('alpha');
        rendered.renderer.destroy();
    });

    test('shift+up selects rather than recalling', async () => {
        stubServer();
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));
        await submitAll(rendered, 'alpha');

        await rendered.mockInput.typeText('unsent', 15);
        rendered.mockInput.pressArrow('up', { shift: true });
        const frame = await settle(rendered);

        expect(frame).toContain('unsent');
        expect(frame).not.toContain('alpha');
        rendered.renderer.destroy();
    });

    test('does not record a submitted slash command', async () => {
        stubServer();
        const rendered = await mount({ probe: <HistoryProbe /> });
        await rendered.waitForFrame(f => f.includes('history[]'));

        await rendered.mockInput.typeText('/models', 15);
        await rendered.waitForFrame(f => f.includes('Switch model'));
        // Escape closes the menu without touching the text, so enter reaches
        // the input's own submit instead of selecting the command.
        rendered.mockInput.pressEscape();
        await settleEscape();
        rendered.mockInput.pressEnter();
        const frame = await settle(rendered);

        expect(frame).toContain('history[]');
        rendered.renderer.destroy();
    });
});

describe('history chrome and /new', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    function stubServer() {
        mockFetch(() => Promise.resolve(sseResponse([])));
    }

    async function settle(rendered: Awaited<ReturnType<typeof mount>>): Promise<string> {
        await tick(50);
        await rendered.renderOnce();
        return rendered.captureCharFrame();
    }

    // Home renders the input at 60 columns; at the suite's default 40 the
    // footer has no room for the hint and clips it.
    test('shows the history hint only once there is something to recall', async () => {
        stubServer();
        const rendered = await mount({ width: 60 });
        const before = await rendered.waitForFrame(f => f.includes('send'));

        expect(before).not.toContain('history');

        await rendered.mockInput.typeText('alpha', 15);
        rendered.mockInput.pressEnter();
        const after = await settle(rendered);

        expect(after).toContain('↑ history');
        expect(after).toContain('↵ send');
        rendered.renderer.destroy();
    });

    test('/new clears the conversation without clearing the history', async () => {
        stubServer();
        const rendered = await mount({ probe: <HistoryProbe /> });
        await rendered.waitForFrame(f => f.includes('history[]'));

        await rendered.mockInput.typeText('alpha', 15);
        rendered.mockInput.pressEnter();
        expect(await settle(rendered)).toContain('history[alpha]');

        await rendered.mockInput.typeText('/new', 15);
        await rendered.waitForFrame(f => f.includes('Start a new session'));
        rendered.mockInput.pressEnter();
        const frame = await settle(rendered);

        // What the user typed is theirs to recall whether or not the
        // conversation it belonged to is still around.
        expect(frame).toContain('history[alpha]');
        rendered.renderer.destroy();
    });
});
