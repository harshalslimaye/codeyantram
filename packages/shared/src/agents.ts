export const AGENT_NAMES = ["Talk", "Build"] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

// Talk and Build both get tool access; only Build can run mutating tools.
export const TOOL_CAPABLE_AGENTS: readonly AgentName[] = ["Talk", "Build"];

// Talk is restricted to read-only tools (see isReadOnlyTool); only Build gets
// the full catalog, including edit_file/write_file/bash.
export const FULL_TOOL_AGENTS: readonly AgentName[] = ["Build"];

export function agentHasTools(name: AgentName): boolean {
    return TOOL_CAPABLE_AGENTS.includes(name);
}

export function agentHasFullToolAccess(name: AgentName): boolean {
    return FULL_TOOL_AGENTS.includes(name);
}
