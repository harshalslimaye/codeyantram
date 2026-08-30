import type { AgentName } from '@codeyantram/shared';

export type Agent = {
    name: AgentName;
};

export const AGENTS: Agent[] = [
    { name: 'Talk' },
    { name: 'Build' },
];

// Named explicitly (not AGENTS[0]) so reordering the list above can't silently change the default.
export const DEFAULT_AGENT = AGENTS.find(agent => agent.name === 'Talk') as Agent;

export function getNextAgent(current: Agent): Agent {
    const index = AGENTS.findIndex(agent => agent.name === current.name);
    return AGENTS[(index + 1) % AGENTS.length] as Agent;
}
