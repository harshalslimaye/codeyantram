import { describe, test, expect } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { useKeyboard } from '@opentui/react';
import { AGENTS, DEFAULT_AGENT } from '../../src/agents';
import { useAgent, AgentProvider, getInitialAgent } from '../../src/providers/agent';

const OTHER_AGENT = AGENTS.find(agent => agent.name !== DEFAULT_AGENT.name)!;

function ShowAgent() {
    const { agent } = useAgent();
    return <text>{agent.name}</text>;
}

describe('useAgent', () => {
    test('throws when used outside an AgentProvider', async () => {
        // @opentui/react wraps the tree in an ErrorBoundary, so the thrown
        // error surfaces as rendered text rather than an uncaught exception.
        const rendered = await testRender(<ShowAgent />, { width: 60, height: 20 });
        const frame = await rendered.waitForFrame(f => f.includes('AgentProvider'));

        expect(frame).toContain('useAgent must be used within an AgentProvider');
        rendered.renderer.destroy();
    });

    test('supplies the default agent inside an AgentProvider', async () => {
        const rendered = await testRender(
            <AgentProvider>
                <ShowAgent />
            </AgentProvider>,
            { width: 60, height: 20 }
        );
        const frame = await rendered.waitForFrame(f => f.includes(DEFAULT_AGENT.name));

        expect(frame).toContain(DEFAULT_AGENT.name);
        rendered.renderer.destroy();
    });
});

describe('AgentProvider', () => {
    function SetAgentHarness() {
        const { agent, setAgent } = useAgent();
        useKeyboard(key => {
            if (key.name === 's') setAgent(OTHER_AGENT);
        });
        return <text>{agent.name}</text>;
    }

    test('setAgent changes the active agent', async () => {
        const rendered = await testRender(
            <AgentProvider>
                <SetAgentHarness />
            </AgentProvider>,
            { width: 60, height: 20 }
        );
        await rendered.waitForFrame(f => f.includes(DEFAULT_AGENT.name));

        rendered.mockInput.pressKey('s');
        const frame = await rendered.waitForFrame(f => f.includes(OTHER_AGENT.name));

        expect(frame).toContain(OTHER_AGENT.name);
        rendered.renderer.destroy();
    });
});

describe('test-environment guard', () => {
    // getInitialAgent/persistAgent go through readPreferences/writePreferences,
    // which no-op under NODE_ENV=test (see utils/preferences.test.ts) —
    // without that, every test mounting AgentProvider would depend on
    // whatever agent happens to be saved on the machine running them.
    test('getInitialAgent returns the default rather than reading the real file', () => {
        expect(getInitialAgent()).toBe(DEFAULT_AGENT);
    });
});
