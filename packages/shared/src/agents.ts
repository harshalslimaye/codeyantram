export const AGENT_NAMES = ["Talk", "Build"] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

// Talk is conversation-only by design; only Build gets tool access.
export const TOOL_CAPABLE_AGENTS: readonly AgentName[] = ["Build"];

export function agentHasTools(name: AgentName): boolean {
    return TOOL_CAPABLE_AGENTS.includes(name);
}
