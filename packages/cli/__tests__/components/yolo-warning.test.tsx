import { describe, expect, test } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { useKeyboard } from '@opentui/react';
import { YoloWarning } from '../../src/components/yolo-warning';
import { AgentProvider, useAgent } from '../../src/providers/agent';
import { ToastContext, type ToastContextValue } from '../../src/providers/toast';
import { AGENTS } from '../../src/agents';
import { NO_BUILTIN_CTRL_C, tick } from '../support/mount';

/** A minimal, precisely-countable stand-in for ToastProvider - same pattern as
 * session-autosave.test.tsx, needed here to distinguish "warned once" from
 * "warned on every switch". */
function mockToast(): { value: ToastContextValue; warnCalls: string[] } {
    const warnCalls: string[] = [];
    const value: ToastContextValue = {
        info: () => '',
        warn: message => {
            warnCalls.push(message);
            return '';
        },
        error: () => '',
        dismiss: () => {},
    };
    return { value, warnCalls };
}

const BUILD = AGENTS.find(agent => agent.name === 'Build')!;
const YOLO = AGENTS.find(agent => agent.name === 'Yolo')!;
const TALK = AGENTS.find(agent => agent.name === 'Talk')!;

function SwitchAgentHarness() {
    const { agent, setAgent } = useAgent();
    useKeyboard(key => {
        if (key.name === 'b') setAgent(BUILD);
        if (key.name === 'y') setAgent(YOLO);
        if (key.name === 't') setAgent(TALK);
    });
    return <text>agent:{agent.name}</text>;
}

function mount(toastValue: ToastContextValue) {
    return testRender(
        <ToastContext.Provider value={toastValue}>
            <AgentProvider>
                <SwitchAgentHarness />
                <YoloWarning />
            </AgentProvider>
        </ToastContext.Provider>,
        { width: 40, height: 5, ...NO_BUILTIN_CTRL_C },
    );
}

describe('YoloWarning', () => {
    test('renders nothing', async () => {
        const { value } = mockToast();
        const rendered = await mount(value);
        await rendered.waitForFrame(f => f.includes('agent:Talk'));

        // Just the harness's own text - YoloWarning contributes no chrome.
        expect(rendered.captureCharFrame().trim()).toContain('agent:Talk');
        rendered.renderer.destroy();
    });

    test('does not warn while on Talk or Build', async () => {
        const { value, warnCalls } = mockToast();
        const rendered = await mount(value);
        await rendered.waitForFrame(f => f.includes('agent:Talk'));

        rendered.mockInput.pressKey('b');
        await rendered.waitForFrame(f => f.includes('agent:Build'));

        expect(warnCalls).toHaveLength(0);
        rendered.renderer.destroy();
    });

    test('warns exactly once on switching to Yolo', async () => {
        const { value, warnCalls } = mockToast();
        const rendered = await mount(value);
        await rendered.waitForFrame(f => f.includes('agent:Talk'));

        rendered.mockInput.pressKey('y');
        await rendered.waitForFrame(f => f.includes('agent:Yolo'));

        expect(warnCalls).toHaveLength(1);
        expect(warnCalls[0]).toContain('Yolo');
        expect(warnCalls[0]).toContain('approval');
        rendered.renderer.destroy();
    });

    test('does not warn again on switching away and back to Yolo', async () => {
        const { value, warnCalls } = mockToast();
        const rendered = await mount(value);
        await rendered.waitForFrame(f => f.includes('agent:Talk'));

        rendered.mockInput.pressKey('y');
        await rendered.waitForFrame(f => f.includes('agent:Yolo'));
        expect(warnCalls).toHaveLength(1);

        // A second pressKey right after the first isn't reliably picked up by
        // waitForFrame's own polling (a known quirk with back-to-back
        // mockInput.pressKey calls of plain characters - see the tick+renderOnce
        // idiom used the same way in agent-picker.test.tsx's filtering tests), so
        // both remaining switches settle with tick + renderOnce instead.
        rendered.mockInput.pressKey('t');
        await tick(50);
        await rendered.renderOnce();
        expect(rendered.captureCharFrame()).toContain('agent:Talk');

        rendered.mockInput.pressKey('y');
        await tick(50);
        await rendered.renderOnce();
        expect(rendered.captureCharFrame()).toContain('agent:Yolo');

        expect(warnCalls).toHaveLength(1);
        rendered.renderer.destroy();
    });
});
