import { afterEach, describe, test, expect } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { useKeyboard } from '@opentui/react';
import { RGBA } from '@opentui/core';
import { DEFAULT_CHAT_MODEL_ID, findSupportedChatModel } from '@codeyantram/shared';
import { ContextOverlay } from '../../src/components/context-overlay';
import { ThemeProvider } from '../../src/providers/theme';
import { DEFAULT_THEME } from '../../src/theme';
import { ModelProvider } from '../../src/providers/model';
import { EffortProvider } from '../../src/providers/effort';
import { AgentProvider } from '../../src/providers/agent';
import { ToastProvider } from '../../src/providers/toast';
import { ChatProvider, useChat } from '../../src/providers/chat';
import { OverlayProvider, useOverlay } from '../../src/providers/overlay';
import { KeyboardProvider, useLayerStack } from '../../src/providers/keyboard';
import { createLayerStack, ROOT_LAYER } from '../../src/keyboard';
import { NO_BUILTIN_CTRL_C, tick } from '../support/mount';
import { mockChatFetch, sseResponse } from '../support/sse';

const DEFAULT_MODEL = findSupportedChatModel(DEFAULT_CHAT_MODEL_ID)!;
// claude-sonnet-5's own contextWindow (see models.ts) - these tests pick usage figures
// that land on whole percentages of it.
const CONTEXT_WINDOW = DEFAULT_MODEL.contextWindow;

// "o" opens the real overlay with a real ContextOverlay inside it, and "m" sends a message
// through the real ChatProvider (against whatever the test's mocked fetch answers with) -
// same two-key shape as effort-picker.test.tsx's Harness, split because pressing both in
// one render is unreliable in this test harness.
function Harness() {
    const overlay = useOverlay();
    const layers = useLayerStack();
    const chat = useChat();

    useKeyboard(key => {
        if (!layers.isOnTop(ROOT_LAYER)) return;
        if (key.name === 'o') overlay.show('Context window', <ContextOverlay />);
        if (key.name === 'm') chat.sendMessage('hello');
    });

    return <text>ready</text>;
}

function mount(width = 70, height = 30) {
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
                                        <Harness />
                                    </OverlayProvider>
                                </ChatProvider>
                            </ToastProvider>
                        </AgentProvider>
                    </EffortProvider>
                </ModelProvider>
            </ThemeProvider>
        </KeyboardProvider>,
        { width, height, ...NO_BUILTIN_CTRL_C }
    ).then(setup => ({ ...setup, layers }));
}

describe('no reading yet', () => {
    test('shows the model but no percentage before any turn has completed', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        rendered.mockInput.pressKey('o');
        const frame = await rendered.waitForFrame(f => f.includes('Context window'));

        expect(frame).toContain(DEFAULT_MODEL.id);
        expect(frame).toContain('No usage recorded yet');
        expect(frame).not.toMatch(/\d+%/);
        rendered.renderer.destroy();
    });
});

describe('with a completed turn', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    function stubServerWithUsage(
        usage: Record<string, number>,
        toolUsage?: { toolName: string; calls: number; resultChars: number }[],
        subagents?: { count: number; inputTokens: number; outputTokens: number },
    ) {
        const done = {
            type: 'done',
            durationMs: 5,
            usage,
            ...(toolUsage !== undefined && { toolUsage }),
            ...(subagents !== undefined && { subagents }),
        };
        mockChatFetch(() =>
            Promise.resolve(
                sseResponse([
                    'data: {"type":"start","messageId":"m1"}\n\n',
                    `data: ${JSON.stringify(done)}\n\n`,
                ]),
            ),
        );
    }

    // A keypress schedules a React state update that isn't in a frame until React
    // flushes it, and waitForFrame's scheduler-idle check can catch the gap between the
    // two (the same race documented in input-bar.test.tsx's prompt-history block) - so
    // this settles explicitly with a tick + a forced render pass after each of the two
    // presses, then reads the frame directly, rather than polling with waitForFrame
    // right after either one.
    async function sendAndOpen(rendered: Awaited<ReturnType<typeof mount>>): Promise<string> {
        rendered.mockInput.pressKey('m');
        await tick(50);
        await rendered.renderOnce();

        rendered.mockInput.pressKey('o');
        await tick(50);
        await rendered.renderOnce();

        return rendered.captureCharFrame();
    }

    test('shows the full breakdown at a normal (under-warn) usage level', async () => {
        stubServerWithUsage({ inputTokens: 0.3 * CONTEXT_WINDOW, outputTokens: 500 });
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        const frame = await sendAndOpen(rendered);

        expect(frame).toContain('30%');
        expect(frame).toContain('Last turn');
        expect(frame).toContain('Session cost');
        expect(frame).toContain('Turns');
        expect(frame).toContain('1'); // one completed turn
        rendered.renderer.destroy();
    });

    test('shows the cache hit rate only when the provider reported cache activity', async () => {
        stubServerWithUsage({ inputTokens: 0.3 * CONTEXT_WINDOW, cacheReadTokens: 0.15 * CONTEXT_WINDOW });
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        const frame = await sendAndOpen(rendered);

        expect(frame).toContain('Cache hit rate');
        expect(frame).toContain('50%'); // 0.15 / 0.3 of that turn's input came from cache
        rendered.renderer.destroy();
    });

    test('omits the cache hit rate line when the provider reported no cache activity', async () => {
        stubServerWithUsage({ inputTokens: 0.3 * CONTEXT_WINDOW });
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        const frame = await sendAndOpen(rendered);

        expect(frame).not.toContain('Cache hit rate');
        rendered.renderer.destroy();
    });

    test('colors the bar with the danger color past the upper threshold', async () => {
        stubServerWithUsage({ inputTokens: 0.9 * CONTEXT_WINDOW });
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        const frame = await sendAndOpen(rendered);
        expect(frame).toContain('90%');

        const barLine = rendered
            .captureSpans()
            .lines.flatMap(line => line.spans)
            .find(span => span.text.includes('█') || span.text.includes('90%'));

        expect(barLine).toBeDefined();
        expect(barLine!.fg.equals(RGBA.fromHex(DEFAULT_THEME.colors.error))).toBe(true);
        rendered.renderer.destroy();
    });

    test('attributes window occupancy to the tools that produced it', async () => {
        stubServerWithUsage({ inputTokens: 0.3 * CONTEXT_WINDOW }, [
            { toolName: 'grep', calls: 2, resultChars: 8_000 },
            { toolName: 'read_file', calls: 1, resultChars: 20_000 },
        ]);
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        const frame = await sendAndOpen(rendered);

        expect(frame).toContain('Tool output (session)');
        expect(frame).toContain('read_file');
        expect(frame).toContain('grep');
        // Sorted by size, so the tool actually filling the window reads first.
        expect(frame.indexOf('read_file')).toBeLessThan(frame.indexOf('grep'));
        // Call counts ride along with the name, so one huge read is distinguishable
        // from many small ones.
        expect(frame).toContain('grep \u00d72');
        rendered.renderer.destroy();
    });

    test('reports worker spend separately from the window', async () => {
        stubServerWithUsage({ inputTokens: 0.3 * CONTEXT_WINDOW }, undefined, {
            count: 3,
            inputTokens: 41_000,
            outputTokens: 600,
        });
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        const frame = await sendAndOpen(rendered);

        expect(frame).toContain('Subagents (session)');
        expect(frame).toContain('Workers spawned');
        // The distinction the section exists to make: this spend is real money that never
        // occupied a byte of the window the rest of the overlay describes.
        expect(frame).toContain('outside this window');
        rendered.renderer.destroy();
    });

    test('omits the subagent section for a session that spawned none', async () => {
        stubServerWithUsage({ inputTokens: 0.3 * CONTEXT_WINDOW });
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        const frame = await sendAndOpen(rendered);

        expect(frame).not.toContain('Subagents');
        rendered.renderer.destroy();
    });

    test('omits the tool-output section for a turn that ran no tools', async () => {
        stubServerWithUsage({ inputTokens: 0.3 * CONTEXT_WINDOW });
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ready'));

        const frame = await sendAndOpen(rendered);

        expect(frame).not.toContain('Tool output');
        rendered.renderer.destroy();
    });
});
