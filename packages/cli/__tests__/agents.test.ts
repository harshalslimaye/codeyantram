import { describe, expect, test } from 'bun:test';
import { AGENTS, BUILD_AGENT, DEFAULT_AGENT, getNextAgent } from '../src/agents';

describe('AGENTS', () => {
    test('lists Talk, Build, and Yolo, in tab-cycle order', () => {
        expect(AGENTS.map(agent => agent.name)).toEqual(['Talk', 'Build', 'Yolo']);
    });
});

describe('DEFAULT_AGENT / BUILD_AGENT', () => {
    test('DEFAULT_AGENT is Talk', () => {
        expect(DEFAULT_AGENT.name).toBe('Talk');
    });

    test('BUILD_AGENT is Build', () => {
        expect(BUILD_AGENT.name).toBe('Build');
    });
});

describe('getNextAgent', () => {
    test('cycles Talk -> Build -> Yolo -> Talk', () => {
        const talk = AGENTS.find(agent => agent.name === 'Talk')!;
        const build = AGENTS.find(agent => agent.name === 'Build')!;
        const yolo = AGENTS.find(agent => agent.name === 'Yolo')!;

        expect(getNextAgent(talk)).toBe(build);
        expect(getNextAgent(build)).toBe(yolo);
        expect(getNextAgent(yolo)).toBe(talk);
    });

    test('a full cycle from any starting agent returns to itself after AGENTS.length steps', () => {
        for (const start of AGENTS) {
            let current = start;
            for (let i = 0; i < AGENTS.length; i++) current = getNextAgent(current);
            expect(current).toBe(start);
        }
    });
});
