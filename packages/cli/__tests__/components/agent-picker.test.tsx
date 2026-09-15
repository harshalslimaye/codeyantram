import { describe, test, expect } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { useKeyboard } from '@opentui/react';
import { AgentPicker } from '../../src/components/agent-picker';
import { useAgent, AgentProvider } from '../../src/providers/agent';
import { ThemeProvider } from '../../src/providers/theme';
import { useOverlay, OverlayProvider } from '../../src/providers/overlay';
import { KeyboardProvider, useLayerStack } from '../../src/providers/keyboard';
import { createLayerStack, ROOT_LAYER } from '../../src/keyboard';
import { AGENTS, DEFAULT_AGENT } from '../../src/agents';
import { NO_BUILTIN_CTRL_C, tick } from '../support/mount';

const OTHER_AGENT = AGENTS.find(agent => agent.name !== DEFAULT_AGENT.name)!;

// "a" opens the real overlay with a real AgentPicker inside it, and a
// persisting `current:<name>` label outside the overlay makes the actual
// active agent observable both during and after the picker is used — same
// end-to-end shape as model-picker.test.tsx's Harness.
//
// Guarded by isOnTop(ROOT_LAYER) for the same reason every other useKeyboard
// handler in this app is: it fires on every keypress regardless of who owns
// the keyboard, and would otherwise re-open the overlay from a query
// character that happens to be "a".
function Harness() {
    const { agent } = useAgent();
    const overlay = useOverlay();
    const layers = useLayerStack();

    useKeyboard(key => {
        if (key.name !== 'a') return;
        if (!layers.isOnTop(ROOT_LAYER)) return;
        overlay.show('Agents', <AgentPicker />);
    });

    return <text>current:{agent.name}</text>;
}

function mount(width = 60, height = 30) {
    const layers = createLayerStack();

    return testRender(
        <KeyboardProvider layers={layers}>
            <ThemeProvider>
                <AgentProvider>
                    <OverlayProvider>
                        <Harness />
                    </OverlayProvider>
                </AgentProvider>
            </ThemeProvider>
        </KeyboardProvider>,
        { width, height, ...NO_BUILTIN_CTRL_C }
    ).then(setup => ({ ...setup, layers }));
}

describe('rendering', () => {
    test('shows every agent', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('a');
        const frame = await rendered.waitForFrame(f => f.includes('Agents'));

        for (const agent of AGENTS) {
            expect(frame).toContain(agent.name);
        }
        rendered.renderer.destroy();
    });

    test('marks the current agent as active', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('a');
        const frame = await rendered.waitForFrame(f => f.includes('Agents'));

        expect(frame).toContain(`● ${DEFAULT_AGENT.name}`);
        rendered.renderer.destroy();
    });
});

describe('filtering', () => {
    // Filtering goes through OverlayList's own query state, not something
    // waitForFrame can reliably poll for here — same scheduler-idle race
    // documented in input-bar.test.tsx and overlay.test.tsx for
    // React-state-driven updates. A tick to let it flush, then one forced
    // render pass, sidesteps it.
    test('narrows the list to the matching agent name', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('a');
        await rendered.waitForFrame(f => f.includes('Agents'));

        await rendered.mockInput.typeText(OTHER_AGENT.name.toLowerCase(), 15);
        await tick(50);
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        expect(frame).toContain(OTHER_AGENT.name);
        for (const agent of AGENTS) {
            // Excludes the still-active agent too: nothing has been selected
            // yet in this test, so the persisting `current:<name>` label
            // outside the overlay legitimately still shows it, regardless of
            // what the list is filtered to.
            if (agent.name === OTHER_AGENT.name || agent.name === DEFAULT_AGENT.name) continue;
            expect(frame).not.toContain(agent.name);
        }
        rendered.renderer.destroy();
    });

    test('shows "No agents found" when the search matches nothing', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('a');
        await rendered.waitForFrame(f => f.includes('Agents'));

        await rendered.mockInput.typeText('zzz', 15);
        await tick(50);
        await rendered.renderOnce();

        expect(rendered.captureCharFrame()).toContain('No agents found');
        rendered.renderer.destroy();
    });
});

describe('selecting an agent', () => {
    test('changes the active agent and closes the overlay', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));
        expect(rendered.captureCharFrame()).toContain(`current:${DEFAULT_AGENT.name}`);

        rendered.mockInput.pressKey('a');
        await rendered.waitForFrame(f => f.includes('Agents'));

        await rendered.mockInput.typeText(OTHER_AGENT.name.toLowerCase(), 15);
        await tick(50);
        await rendered.renderOnce();
        expect(rendered.captureCharFrame()).toContain(OTHER_AGENT.name);

        rendered.mockInput.pressEnter();
        await tick(50);
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        expect(frame).not.toContain('Agents');
        expect(frame).toContain(`current:${OTHER_AGENT.name}`);
        rendered.renderer.destroy();
    });

    // OTHER_AGENT above resolves to whichever non-default agent AGENTS lists
    // first (Build) - this targets Yolo specifically, so the three-agent
    // picker's full range (not just "any non-default agent") is exercised.
    test('can select Yolo specifically', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('a');
        await rendered.waitForFrame(f => f.includes('Agents'));

        await rendered.mockInput.typeText('yolo', 15);
        await tick(50);
        await rendered.renderOnce();
        expect(rendered.captureCharFrame()).toContain('Yolo');

        rendered.mockInput.pressEnter();
        await tick(50);
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        expect(frame).not.toContain('Agents');
        expect(frame).toContain('current:Yolo');
        rendered.renderer.destroy();
    });
});
