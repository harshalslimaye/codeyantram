import type { AgentName } from '@codeyantram/shared';

export type Agent = {
    name: AgentName;
};

// Order is the tab-cycle order too (see getNextAgent) - escalating from
// read-only, to gated-mutating, to ungated-mutating.
export const AGENTS: Agent[] = [
    { name: 'Talk' },
    { name: 'Build' },
    { name: 'Yolo' },
];

// Named explicitly (not AGENTS[0]) so reordering the list above can't silently change the default.
export const DEFAULT_AGENT = AGENTS.find(agent => agent.name === 'Talk') as Agent;

// The agent /init runs as - it needs write_file, which only Build has.
export const BUILD_AGENT = AGENTS.find(agent => agent.name === 'Build') as Agent;

export function getNextAgent(current: Agent): Agent {
    const index = AGENTS.findIndex(agent => agent.name === current.name);
    return AGENTS[(index + 1) % AGENTS.length] as Agent;
}
